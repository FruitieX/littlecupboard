use crate::{Server, auth::authenticate, db::Database, error::Result, model::*};
use axum::{Json, extract::State, http::HeaderMap};
use chrono::{DateTime, Datelike, Utc};
use rusqlite::params;
use serde_json::{Value, json};
use std::collections::BTreeMap;

// Treat a purchase's amount as coverage until the next shopping day. Repeated
// purchases on one day form one basket; unrelated units remain separate.
fn inferred_rate(
    history: &[(DateTime<Utc>, Value)],
    zone: chrono_tz::Tz,
    period: i64,
) -> Option<ConsumptionRate> {
    let mut days = BTreeMap::<chrono::NaiveDate, BTreeMap<String, f64>>::new();
    for (at, detail) in history {
        let amounts: Vec<Amount> = detail
            .get("amounts")
            .and_then(|value| serde_json::from_value(value.clone()).ok())
            .filter(|amounts: &Vec<Amount>| !amounts.is_empty())
            .unwrap_or_else(|| {
                vec![Amount {
                    quantity: detail["quantity"].as_f64().unwrap_or(0.0),
                    unit: detail["unit"].as_str().unwrap_or("").into(),
                }]
            });
        for amount in amounts {
            if !amount.quantity.is_finite() || amount.quantity <= 0.0 || amount.unit.is_empty() {
                continue;
            }
            let amount = crate::domain::normalize(&amount);
            *days
                .entry(at.with_timezone(&zone).date_naive())
                .or_default()
                .entry(amount.unit)
                .or_default() += amount.quantity;
        }
    }
    let days = days.into_iter().collect::<Vec<_>>();
    let mut samples = BTreeMap::<String, Vec<f64>>::new();
    for pair in days.windows(2) {
        let interval = (pair[1].0 - pair[0].0).num_days();
        if !(1..=180).contains(&interval) {
            continue;
        }
        for (unit, quantity) in &pair[0].1 {
            // A following purchase in another unit gives no evidence that this
            // quantity lasted until that date (e.g. bottles versus litres).
            if pair[1].1.contains_key(unit) {
                samples
                    .entry(unit.clone())
                    .or_default()
                    .push(quantity / interval as f64);
            }
        }
    }
    let (mut unit, mut samples) = samples
        .into_iter()
        .filter(|(_, values)| values.len() >= 2)
        .max_by_key(|(_, values)| values.len())?;
    samples.sort_by(f64::total_cmp);
    let middle = samples.len() / 2;
    let daily = if samples.len().is_multiple_of(2) {
        (samples[middle - 1] + samples[middle]) / 2.0
    } else {
        samples[middle]
    };
    let mut quantity = daily * period as f64;
    if quantity >= 1000.0 && (unit == "g" || unit == "ml") {
        quantity /= 1000.0;
        unit = if unit == "g" { "kg" } else { "L" }.into();
    }
    quantity = (quantity * 1000.0).round() / 1000.0;
    (quantity > 0.0).then_some(ConsumptionRate {
        quantity,
        unit,
        days: period as f64,
    })
}

pub fn summarize(
    conn: &rusqlite::Connection,
    household: &str,
    state: &HouseholdState,
) -> Result<Value> {
    let events=conn.prepare("SELECT at,detail FROM events WHERE household_id=?1 AND kind='checkItem' AND undone=0 ORDER BY at LIMIT 10000")?.query_map(params![household],|row|Ok((row.get::<_,String>(0)?,row.get::<_,String>(1)?)))?.collect::<std::result::Result<Vec<_>,_>>()?;
    let mut purchases: BTreeMap<String, Vec<(DateTime<Utc>, Value)>> = BTreeMap::new();
    let mut weekdays = BTreeMap::<String, u32>::new();
    let mut baskets = BTreeMap::<String, Vec<String>>::new();
    for (at, detail) in events {
        let detail: Value = serde_json::from_str(&detail)?;
        let Some(id) = detail["productId"].as_str() else {
            continue;
        };
        let Ok(at) = DateTime::parse_from_rfc3339(&at) else {
            continue;
        };
        let at = at.with_timezone(&Utc);
        let history = purchases.entry(id.to_string()).or_default();
        if detail["checked"] == false {
            history.pop();
            continue;
        }
        if detail["checked"] != true {
            continue;
        }
        history.push((at, detail));
    }
    let mut restock = vec![];
    let mut habits = vec![];
    let zone = state
        .preferences
        .time_zone
        .parse::<chrono_tz::Tz>()
        .unwrap_or(chrono_tz::UTC);
    for (id, history) in &purchases {
        let Some((last, detail)) = history.last() else {
            continue;
        };
        let product = crate::domain::product(state, id).ok();
        let Some(product) = product else { continue };
        let days = history
            .iter()
            .map(|(at, _)| at.with_timezone(&zone).date_naive())
            .collect::<std::collections::BTreeSet<_>>()
            .into_iter()
            .collect::<Vec<_>>();
        let mut intervals = days
            .windows(2)
            .map(|pair| (pair[1] - pair[0]).num_days())
            .filter(|days| *days >= 1 && *days <= 180)
            .collect::<Vec<_>>();
        intervals.sort();
        let interval = if intervals.len() >= 2 {
            Some(intervals[intervals.len() / 2])
        } else {
            None
        };
        let elapsed = (Utc::now() - *last).num_days();
        let note = history
            .iter()
            .filter_map(|(_, detail)| detail["note"].as_str())
            .filter(|note| !note.is_empty())
            .fold(BTreeMap::<String, u32>::new(), |mut counts, note| {
                *counts.entry(note.into()).or_default() += 1;
                counts
            })
            .into_iter()
            .max_by_key(|(_, count)| *count)
            .map(|(note, _)| note)
            .unwrap_or_default();
        let store = history
            .iter()
            .filter_map(|(_, detail)| detail["storeId"].as_str())
            .fold(BTreeMap::<String, u32>::new(), |mut counts, store| {
                *counts.entry(store.into()).or_default() += 1;
                counts
            })
            .into_iter()
            .max_by_key(|(_, count)| *count)
            .map(|(store, _)| store)
            .unwrap_or_default();
        let package = history
            .iter()
            .fold(
                BTreeMap::<String, (usize, &Value)>::new(),
                |mut counts, (_, detail)| {
                    if let (Some(quantity), Some(unit)) =
                        (detail["quantity"].as_f64(), detail["unit"].as_str())
                    {
                        let amount = crate::domain::normalize(&Amount {
                            quantity,
                            unit: unit.into(),
                        });
                        let key = serde_json::to_string(&amount).expect("finite purchase amount");
                        let entry = counts.entry(key).or_insert((0, detail));
                        entry.0 += 1;
                        entry.1 = detail;
                    }
                    counts
                },
            )
            .into_values()
            .max_by_key(|(count, _)| *count)
            .map(|(_, detail)| detail)
            .unwrap_or(detail);
        let estimated = interval.and_then(|period| inferred_rate(history, zone, period));
        let manual = state.consumption_rates.get(id);
        let effective = manual.or(estimated.as_ref());
        let configured_interval = manual.and_then(|rate| {
            let purchased = crate::domain::normalize(&Amount {
                quantity: package["quantity"].as_f64()?,
                unit: package["unit"].as_str()?.into(),
            });
            let consumed = crate::domain::normalize(&Amount {
                quantity: rate.quantity,
                unit: rate.unit.clone(),
            });
            (purchased.unit == consumed.unit).then_some(
                (purchased.quantity / consumed.quantity * rate.days)
                    .ceil()
                    .max(1.0) as i64,
            )
        });
        let effective_interval = configured_interval.or(interval);
        habits.push(json!({"productId":id,"name":product.name,"purchases":history.len(),"intervalDays":interval,"confidence":if intervals.len()>=5 {"established"}else if intervals.len()>=2 {"emerging"}else{"learning"},"lastBought":last,"estimatedConsumption":estimated,"consumptionRate":effective,"consumptionSource":if manual.is_some(){"manual"}else if estimated.is_some(){"estimated"}else{"learning"},"preferredNote":note,"quantity":package["quantity"],"unit":package["unit"],"storeId":store}));
        for (at, _) in history {
            let day = at.with_timezone(&zone);
            *weekdays.entry(day.weekday().to_string()).or_default() += 1;
            baskets
                .entry(day.date_naive().to_string())
                .or_default()
                .push(id.clone());
        }
        let feedback = state.suggestion_feedback.get(&format!("restock:{id}"));
        let hidden = feedback.is_some_and(|feedback| {
            feedback.status == "dismissed" && feedback.at.as_str() > last.to_rfc3339().as_str()
                || feedback
                    .until
                    .as_ref()
                    .is_some_and(|until| until.as_str() > Utc::now().to_rfc3339().as_str())
        });
        if let Some(interval) = effective_interval
            && elapsed >= interval
            && !hidden
            && !state.archived_product_ids.contains(id)
            && !state
                .items
                .iter()
                .any(|item| item.id == *id && !item.checked)
        {
            restock.push(json!({"product":product,"quantity":package["quantity"],"unit":package["unit"],"note":note,"intervalDays":interval,"daysSince":elapsed,"confidence":if intervals.len()>=5 {"established"}else{"emerging"},"consumptionRate":effective,"consumptionSource":if configured_interval.is_some(){"manual"}else{"estimated"},"reason":if let Some(rate)=manual.filter(|_|configured_interval.is_some()) {format!("Your rate: {} {} every {} days; usually bought as {} {}. Last bought {} days ago. Worth checking.",rate.quantity,rate.unit,rate.days,package["quantity"],package["unit"].as_str().unwrap_or(""),elapsed)} else if manual.is_some() {format!("Usually bought about every {} days; last bought {} days ago. Your rate uses a different unit, so this suggestion follows purchase frequency. Worth checking.",interval,elapsed)} else {format!("Bought on {} separate days, usually about every {} days; last bought {} days ago. Worth checking.",days.len(),interval,elapsed)}}));
        }
    }
    let mut pairs = BTreeMap::<(String, String), u32>::new();
    for ids in baskets.values() {
        let ids = ids
            .iter()
            .collect::<std::collections::BTreeSet<_>>()
            .into_iter()
            .collect::<Vec<_>>();
        for (i, left) in ids.iter().enumerate() {
            for right in ids.iter().skip(i + 1) {
                *pairs
                    .entry(((*left).clone(), (*right).clone()))
                    .or_default() += 1;
            }
        }
    }
    let mut associations = pairs
        .into_iter()
        .filter(|(_, count)| *count >= 3)
        .collect::<Vec<_>>();
    associations.sort_by_key(|(_, count)| std::cmp::Reverse(*count));
    Ok(
        json!({"restock":restock,"habits":habits,"shoppingDays":weekdays,"associations":associations.into_iter().take(12).map(|((a,b),count)|json!({"products":[a,b],"daysTogether":count})).collect::<Vec<_>>(),"purchaseCount":purchases.values().map(Vec::len).sum::<usize>()}),
    )
}
pub async fn insights(State(server): State<Server>, headers: HeaderMap) -> Result<Json<Value>> {
    let actor = authenticate(&server, &headers)?;
    let conn = server.db.lock()?;
    let state = Database::snapshot(&conn, &actor.household_id)?.state;
    Ok(Json(summarize(&conn, &actor.household_id, &state)?))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn purchase(day: i64, quantity: f64, unit: &str) -> (DateTime<Utc>, Value) {
        (
            DateTime::parse_from_rfc3339("2026-09-01T12:00:00Z")
                .unwrap()
                .with_timezone(&Utc)
                + chrono::Duration::days(day),
            json!({"quantity":quantity,"unit":unit}),
        )
    }

    #[test]
    fn consumption_merges_same_day_purchases_converts_units_and_resists_outliers() {
        let history = vec![
            purchase(0, 500.0, "g"),
            purchase(0, 0.5, "kg"),
            purchase(7, 1.0, "kg"),
            purchase(14, 100.0, "kg"),
            purchase(21, 1.0, "kg"),
        ];
        let rate = inferred_rate(&history, chrono_tz::UTC, 7).unwrap();
        assert_eq!(
            rate,
            ConsumptionRate {
                quantity: 1.0,
                unit: "kg".into(),
                days: 7.0
            }
        );
        assert!(
            inferred_rate(&history[..3], chrono_tz::UTC, 7).is_none(),
            "Two distinct days cannot establish a rate"
        );
    }

    #[test]
    fn consumption_does_not_guess_package_conversions_or_include_long_gaps() {
        let history = vec![
            purchase(0, 2.0, "L"),
            purchase(7, 2.0, "bottle"),
            purchase(14, 2.0, "L"),
        ];
        assert!(inferred_rate(&history, chrono_tz::UTC, 7).is_none());
        let history = vec![
            purchase(0, 2.0, "L"),
            purchase(200, 2.0, "L"),
            purchase(400, 2.0, "L"),
        ];
        assert!(inferred_rate(&history, chrono_tz::UTC, 7).is_none());
    }
}
