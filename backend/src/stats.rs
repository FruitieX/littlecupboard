use crate::{Server, auth::authenticate, db::Database, error::Result, model::*};
use axum::{Json, extract::State, http::HeaderMap};
use chrono::{DateTime, Datelike, NaiveDate, Timelike, Utc};
use rusqlite::params;
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

struct Purchase {
    at: DateTime<chrono_tz::Tz>,
    product: String,
    actor: String,
    store: String,
}

fn median(values: &mut [i64]) -> Option<i64> {
    values.sort_unstable();
    (!values.is_empty()).then(|| values[values.len() / 2])
}

fn top(
    counts: BTreeMap<String, u32>,
    names: impl Fn(&str) -> String,
    limit: usize,
) -> Vec<NamedCount> {
    let mut list = counts
        .into_iter()
        .map(|(id, count)| NamedCount {
            name: names(&id),
            id,
            count,
        })
        .collect::<Vec<_>>();
    list.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.name.cmp(&b.name)));
    list.truncate(limit);
    list
}

/// Household statistics derived from durable purchase events and meal
/// feedback. Undone events are excluded and restoring a checked item cancels
/// its most recent purchase, matching the learning rules in insights.
pub fn household_stats(
    events: &[(String, String, String, String)],
    state: &HouseholdState,
    now: DateTime<Utc>,
) -> HouseholdStats {
    let zone = state
        .preferences
        .time_zone
        .parse::<chrono_tz::Tz>()
        .unwrap_or(chrono_tz::UTC);
    let mut purchases: Vec<Purchase> = vec![];
    let mut finishes: Vec<DateTime<chrono_tz::Tz>> = vec![];
    for (actor, kind, at, detail) in events {
        let Ok(at) = DateTime::parse_from_rfc3339(at) else {
            continue;
        };
        let at = at.with_timezone(&zone);
        let detail: Value = serde_json::from_str(detail).unwrap_or(Value::Null);
        match kind.as_str() {
            // An automatic finish ends the trip at its last check.
            "finishTrip" => finishes.push(
                detail["lastCheckAt"]
                    .as_str()
                    .and_then(|last| DateTime::parse_from_rfc3339(last).ok())
                    .map_or(at, |last| last.with_timezone(&zone)),
            ),
            "checkItem" => {
                let Some(product) = detail["productId"].as_str() else {
                    continue;
                };
                if detail["checked"] == false {
                    if let Some(index) = purchases.iter().rposition(|p| p.product == product) {
                        purchases.remove(index);
                    }
                } else if detail["checked"] == true {
                    purchases.push(Purchase {
                        at,
                        product: product.into(),
                        actor: actor.clone(),
                        store: detail["storeId"].as_str().unwrap_or("").into(),
                    });
                }
            }
            _ => {}
        }
    }
    let day = |purchase: &Purchase| purchase.at.date_naive();
    let trip_days = purchases.iter().map(day).collect::<BTreeSet<NaiveDate>>();
    let today = now.with_timezone(&zone).date_naive();
    let this_monday = today - chrono::Duration::days(today.weekday().num_days_from_monday() as i64);
    let weeks = (0..12)
        .rev()
        .map(|back| {
            let start = this_monday - chrono::Duration::weeks(back);
            let end = start + chrono::Duration::days(7);
            WeekStat {
                week_start: start.to_string(),
                items: purchases
                    .iter()
                    .filter(|p| day(p) >= start && day(p) < end)
                    .count() as u32,
                trips: trip_days.range(start..end).count() as u32,
            }
        })
        .collect();
    let mut weekdays = vec![0u32; 7];
    for date in &trip_days {
        weekdays[date.weekday().num_days_from_monday() as usize] += 1;
    }
    let mut hours = vec![0u32; 24];
    for purchase in &purchases {
        hours[purchase.at.hour() as usize] += 1;
    }
    let mut gaps = trip_days
        .iter()
        .zip(trip_days.iter().skip(1))
        .map(|(a, b)| (*b - *a).num_days())
        .collect::<Vec<_>>();
    // A trip runs from its first check to Finish trip on the same local day.
    let mut durations = vec![];
    let mut previous: Option<DateTime<chrono_tz::Tz>> = None;
    for finish in &finishes {
        let first = purchases
            .iter()
            .filter(|p| p.at <= *finish && previous.is_none_or(|before| p.at > before))
            .filter(|p| day(p) == finish.date_naive())
            .map(|p| p.at)
            .min();
        if let Some(first) = first {
            let minutes = (*finish - first).num_minutes();
            if (1..=240).contains(&minutes) {
                durations.push(minutes as f64);
            }
        }
        previous = Some(*finish);
    }
    let product_name = |id: &str| {
        crate::domain::product(state, id)
            .map(|product| product.name)
            .unwrap_or_else(|_| id.replace('-', " "))
    };
    let mut by_product = BTreeMap::<String, Vec<&Purchase>>::new();
    for purchase in &purchases {
        by_product
            .entry(purchase.product.clone())
            .or_default()
            .push(purchase);
    }
    let product_stat = |id: &String, list: &Vec<&Purchase>| {
        let days = list.iter().map(|p| day(p)).collect::<BTreeSet<_>>();
        let mut intervals = days
            .iter()
            .zip(days.iter().skip(1))
            .map(|(a, b)| (*b - *a).num_days())
            .filter(|days| (1..=180).contains(days))
            .collect::<Vec<_>>();
        ProductStat {
            product_id: id.clone(),
            name: product_name(id),
            count: list.len() as u32,
            interval_days: if intervals.len() >= 2 {
                median(&mut intervals)
            } else {
                None
            },
            last_bought: list
                .last()
                .map(|p| p.at.with_timezone(&Utc).to_rfc3339())
                .unwrap_or_default(),
        }
    };
    let mut top_products = by_product
        .iter()
        .map(|(id, list)| product_stat(id, list))
        .collect::<Vec<_>>();
    top_products.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.name.cmp(&b.name)));
    let mut lapsed = top_products
        .iter()
        .filter(|stat| !state.archived_product_ids.contains(&stat.product_id))
        .filter(|stat| {
            !state
                .items
                .iter()
                .any(|item| item.id == stat.product_id && !item.checked)
        })
        .filter_map(|stat| {
            let interval = stat.interval_days?;
            let last = DateTime::parse_from_rfc3339(&stat.last_bought).ok()?;
            let since = (now - last.with_timezone(&Utc)).num_days();
            (since >= (interval * 3).max(21)).then(|| (since, stat.clone()))
        })
        .collect::<Vec<_>>();
    lapsed.sort_by_key(|(since, _)| std::cmp::Reverse(*since));
    top_products.truncate(8);
    let mut groups = BTreeMap::<String, u32>::new();
    let mut shoppers = BTreeMap::<String, u32>::new();
    let mut stores = BTreeMap::<String, u32>::new();
    let mut store_days = BTreeSet::<(NaiveDate, String)>::new();
    for purchase in &purchases {
        let group = crate::domain::product(state, &purchase.product)
            .map(|product| {
                state
                    .product_groups
                    .get(&purchase.product)
                    .cloned()
                    .unwrap_or(product.category)
            })
            .unwrap_or_else(|_| "Other".into());
        *groups.entry(group).or_default() += 1;
        *shoppers.entry(purchase.actor.clone()).or_default() += 1;
        if !purchase.store.is_empty() && store_days.insert((day(purchase), purchase.store.clone()))
        {
            *stores.entry(purchase.store.clone()).or_default() += 1;
        }
    }
    let recipes = state
        .recipe_book
        .iter()
        .chain(&state.custom_recipes)
        .map(|recipe| (recipe.id.clone(), recipe.name.clone()))
        .collect::<BTreeMap<_, _>>();
    let mut recipe_stats = BTreeMap::<String, RecipeStat>::new();
    let (mut meals_cooked, mut meals_skipped) = (0, 0);
    for (date, feedback) in &state.meal_feedback {
        let entry = recipe_stats
            .entry(feedback.recipe_id.clone())
            .or_insert_with(|| RecipeStat {
                recipe_id: feedback.recipe_id.clone(),
                name: recipes
                    .get(&feedback.recipe_id)
                    .cloned()
                    .unwrap_or_else(|| "Removed recipe".into()),
                cooked: 0,
                skipped: 0,
                rating: None,
                last_cooked: None,
            });
        if feedback.status == "cooked" {
            meals_cooked += 1;
            entry.cooked += 1;
            if entry.last_cooked.as_ref().is_none_or(|last| last < date) {
                entry.last_cooked = Some(date.clone());
            }
        } else if feedback.status == "skipped" {
            meals_skipped += 1;
            entry.skipped += 1;
        }
    }
    for stat in recipe_stats.values_mut() {
        let ratings = state
            .meal_feedback
            .values()
            .filter(|f| f.recipe_id == stat.recipe_id && f.status == "cooked")
            .filter_map(|f| f.rating)
            .map(f64::from)
            .collect::<Vec<_>>();
        if !ratings.is_empty() {
            stat.rating =
                Some((ratings.iter().sum::<f64>() / ratings.len() as f64 * 10.0).round() / 10.0);
        }
    }
    let mut top_recipes = recipe_stats
        .into_values()
        .filter(|stat| stat.cooked > 0)
        .collect::<Vec<_>>();
    top_recipes.sort_by(|a, b| b.cooked.cmp(&a.cooked).then_with(|| a.name.cmp(&b.name)));
    top_recipes.truncate(6);
    let store_name = |id: &str| {
        state
            .stores
            .iter()
            .find(|store| store.id == id)
            .map(|store| store.name.clone())
            .unwrap_or_else(|| "A removed shop".into())
    };
    HouseholdStats {
        purchases: purchases.len() as u32,
        trips: trip_days.len() as u32,
        distinct_products: by_product.len() as u32,
        average_trip_items: (!trip_days.is_empty())
            .then(|| (purchases.len() as f64 / trip_days.len() as f64 * 10.0).round() / 10.0),
        average_trip_minutes: (!durations.is_empty())
            .then(|| (durations.iter().sum::<f64>() / durations.len() as f64).round()),
        median_days_between_trips: median(&mut gaps),
        since: purchases
            .first()
            .map(|p| p.at.with_timezone(&Utc).to_rfc3339()),
        weeks,
        weekdays,
        hours,
        top_products,
        groups: top(groups, |id| id.to_string(), 8),
        stores: top(stores, store_name, 5),
        shoppers: top(shoppers, |id| id.to_string(), 6),
        meals_cooked,
        meals_skipped,
        top_recipes,
        lapsed: lapsed.into_iter().map(|(_, stat)| stat).take(6).collect(),
    }
}

pub async fn stats(
    State(server): State<Server>,
    headers: HeaderMap,
) -> Result<Json<HouseholdStats>> {
    let actor = authenticate(&server, &headers)?;
    let conn = server.db.lock()?;
    let state = Database::snapshot(&conn, &actor.household_id)?.state;
    let events = conn
        .prepare("SELECT actor,kind,at,detail FROM events WHERE household_id=?1 AND kind IN ('checkItem','finishTrip') AND undone=0 ORDER BY at LIMIT 50000")?
        .query_map(params![actor.household_id], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(Json(household_stats(&events, &state, Utc::now())))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn event(actor: &str, kind: &str, at: &str, detail: Value) -> (String, String, String, String) {
        (actor.into(), kind.into(), at.into(), detail.to_string())
    }

    #[test]
    fn stats_count_trips_restores_durations_and_lapsed_items() {
        let mut state = crate::model::fresh_state(false, "UTC".into());
        let store = state.stores[0].id.clone();
        let check = |id: &str, checked: bool| serde_json::json!({"productId": id, "checked": checked, "storeId": store});
        let mut events = vec![];
        // Coffee every 7 days for a month, then nothing for ten weeks.
        for day in ["2026-06-01", "2026-06-08", "2026-06-15", "2026-06-22"] {
            events.push(event(
                "Sam",
                "checkItem",
                &format!("{day}T10:00:00Z"),
                check("coffee", true),
            ));
        }
        // One trip with a restored item and a 30 minute duration.
        events.push(event(
            "Sam",
            "checkItem",
            "2026-09-05T10:00:00Z",
            check("milk", true),
        ));
        events.push(event(
            "Bo",
            "checkItem",
            "2026-09-05T10:10:00Z",
            check("eggs", true),
        ));
        events.push(event(
            "Bo",
            "checkItem",
            "2026-09-05T10:12:00Z",
            check("eggs", false),
        ));
        events.push(event(
            "Bo",
            "checkItem",
            "2026-09-05T10:20:00Z",
            check("bananas", true),
        ));
        events.push(event(
            "Bo",
            "finishTrip",
            "2026-09-05T10:30:00Z",
            serde_json::json!({"count": 2}),
        ));
        state.meal_feedback.insert(
            "2026-09-02".into(),
            MealFeedback {
                recipe_id: "family-soup".into(),
                status: "cooked".into(),
                servings: 4.0,
                at: "2026-09-02T12:00:00Z".into(),
                rating: Some(5),
                consumed: true,
                automatic: false,
            },
        );
        let now = DateTime::parse_from_rfc3339("2026-09-07T12:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let stats = household_stats(&events, &state, now);
        assert_eq!(stats.purchases, 6, "the restored eggs are not a purchase");
        assert_eq!(stats.trips, 5);
        assert_eq!(stats.average_trip_minutes, Some(30.0));
        assert_eq!(stats.median_days_between_trips, Some(7));
        assert_eq!(stats.weekdays[0], 4, "four Monday trips");
        assert_eq!(stats.weekdays[5], 1, "one Saturday trip");
        assert_eq!(stats.top_products[0].product_id, "coffee");
        assert_eq!(stats.top_products[0].interval_days, Some(7));
        assert_eq!(stats.lapsed[0].product_id, "coffee");
        assert_eq!(stats.shoppers[0].name, "Sam");
        assert_eq!(stats.shoppers[0].count, 5);
        assert_eq!(stats.meals_cooked, 1);
        assert_eq!(stats.top_recipes[0].rating, Some(5.0));
        assert_eq!(stats.weeks.len(), 12);
        assert_eq!(stats.weeks[11].items, 0);
        assert_eq!(
            stats.weeks[10].items, 2,
            "milk and bananas in the week of 31 August"
        );
    }
}
