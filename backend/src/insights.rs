use crate::{Server, auth::authenticate, db::Database, error::Result, model::*};
use axum::{Json, extract::State, http::HeaderMap};
use chrono::{DateTime, Datelike, NaiveDate, Utc};
use rusqlite::params;
use serde_json::{Value, json};
use std::collections::BTreeMap;

// Treat a purchase's amount as coverage until the next shopping day. Repeated
// purchases on one day form one basket; unrelated units remain separate.
fn event_amounts(detail: &Value) -> Vec<Amount> {
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
    amounts
        .into_iter()
        .filter(|amount| {
            amount.quantity.is_finite() && amount.quantity >= 0.0 && !amount.unit.is_empty()
        })
        .map(|amount| crate::domain::normalize(&amount))
        .collect()
}

fn inferred_rate(
    history: &[(DateTime<Utc>, Value)],
    zone: chrono_tz::Tz,
    period: i64,
) -> Option<ConsumptionRate> {
    let mut days = BTreeMap::<chrono::NaiveDate, BTreeMap<String, f64>>::new();
    for (at, detail) in history {
        for amount in event_amounts(detail) {
            if amount.quantity <= 0.0 {
                continue;
            }
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

fn suggestible(state: &HouseholdState, id: &str, last: &DateTime<Utc>) -> bool {
    let feedback = state.suggestion_feedback.get(&format!("restock:{id}"));
    let hidden = feedback.is_some_and(|feedback| {
        feedback.status == "dismissed" && feedback.at.as_str() > last.to_rfc3339().as_str()
            || feedback
                .until
                .as_ref()
                .is_some_and(|until| until.as_str() > Utc::now().to_rfc3339().as_str())
    });
    !hidden
        && !state
            .archived_product_ids
            .iter()
            .any(|archived| archived == id)
        && !state
            .items
            .iter()
            .any(|item| item.id == id && !item.checked)
}

fn weekday_name(day: chrono::Weekday) -> &'static str {
    [
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
        "Sunday",
    ][day.num_days_from_monday() as usize]
}

fn amounts_label(amounts: &[Amount]) -> String {
    amounts
        .iter()
        .map(|amount| {
            let (quantity, unit) = display_unit(amount);
            format!("{} {}", trim_number(quantity), unit)
        })
        .collect::<Vec<_>>()
        .join(" + ")
}

fn display_unit(amount: &Amount) -> (f64, String) {
    match amount.unit.as_str() {
        "g" if amount.quantity >= 1000.0 => (amount.quantity / 1000.0, "kg".into()),
        "ml" if amount.quantity >= 1000.0 => (amount.quantity / 1000.0, "L".into()),
        _ => (amount.quantity, amount.unit.clone()),
    }
}

fn trim_number(value: f64) -> String {
    let rounded = if value >= 10.0 {
        value.round()
    } else {
        (value * 10.0).round() / 10.0
    };
    format!("{rounded}")
}

fn days_label(days: f64) -> String {
    match days.round() as i64 {
        0 | 1 => "a day".into(),
        n if n < 14 => format!("{n} days"),
        n => format!("{} weeks", n / 7),
    }
}

/// The next date after `today` on a weekday the household regularly shops,
/// meaning at least half as often as its busiest shopping weekday.
pub fn next_shopping_day(
    trip_days: &std::collections::BTreeSet<NaiveDate>,
    today: NaiveDate,
) -> Option<NaiveDate> {
    let recent = trip_days
        .iter()
        .filter(|day| (today - **day).num_days() <= 120)
        .collect::<Vec<_>>();
    if recent.len() < 3 {
        return None;
    }
    let mut counts = [0u32; 7];
    for day in &recent {
        counts[day.weekday().num_days_from_monday() as usize] += 1;
    }
    let busiest = *counts.iter().max()?;
    (1..=7)
        .map(|offset| today + chrono::Duration::days(offset))
        .find(|day| counts[day.weekday().num_days_from_monday() as usize] * 2 >= busiest)
}

/// Projects pantry entries forward using each product's effective rate.
/// Purchases and confirmations reset `observed_at`, so the projection only
/// covers the time since the household last told us something.
#[allow(clippy::too_many_arguments)]
pub fn project_stock(
    state: &HouseholdState,
    rates: &BTreeMap<String, (ConsumptionRate, &'static str)>,
    packages: &BTreeMap<String, Amount>,
    purchases: &BTreeMap<String, Vec<(DateTime<Utc>, Value)>>,
    anchors: &BTreeMap<String, (DateTime<Utc>, Vec<Amount>)>,
    now: DateTime<Utc>,
    zone: chrono_tz::Tz,
    horizon_days: f64,
) -> Vec<StockEstimate> {
    let today = now.with_timezone(&zone).date_naive();
    let mut stock = state
        .pantry
        .iter()
        .filter_map(|(id, entry)| {
            let product = crate::domain::product(state, id).ok()?;
            let recorded = crate::domain::totals(&entry.amounts);
            let observed = DateTime::parse_from_rfc3339(&entry.observed_at)
                .map_or(now, |at| at.with_timezone(&Utc));
            let elapsed = ((now - observed).num_minutes() as f64 / 1440.0).max(0.0);
            let rate = rates
                .get(id)
                .map(|(rate, source)| (rate.clone(), *source))
                .or_else(|| {
                    state
                        .consumption_rates
                        .get(id)
                        .map(|rate| (rate.clone(), "manual"))
                });
            let daily = rate.as_ref().and_then(|(rate, _)| {
                let amount = crate::domain::normalize(&Amount {
                    quantity: rate.quantity,
                    unit: rate.unit.clone(),
                });
                (rate.days > 0.0 && amount.quantity > 0.0).then(|| Amount {
                    quantity: amount.quantity / rate.days,
                    unit: amount.unit,
                })
            });
            // Stored estimates only ever add purchases, so replay them instead:
            // start at the last confirmed total, add each later purchase and
            // subtract the daily rate in between. Purchases are kept as
            // batches: the oldest is used first and, with a shelf life, a
            // batch that outlives it is counted as spoiled. Without a
            // confirmation the first purchase starts from empty.
            let shelf = crate::domain::shelf_life(state, id);
            let tracked = daily.as_ref().and_then(|daily| {
                let unit_of = |amounts: &[Amount]| {
                    amounts
                        .iter()
                        .filter(|amount| amount.unit == daily.unit)
                        .map(|amount| amount.quantity)
                        .sum::<f64>()
                };
                let mut batches = Vec::<(DateTime<Utc>, f64)>::new();
                let mut clock: Option<DateTime<Utc>> = None;
                let mut peak = 0.0_f64;
                let advance = |batches: &mut Vec<(DateTime<Utc>, f64)>,
                               clock: &mut Option<DateTime<Utc>>,
                               to: DateTime<Utc>| {
                    let Some(mut at) = *clock else {
                        *clock = Some(to);
                        return;
                    };
                    while at < to {
                        let oldest = batches.first().map(|(bought, _)| *bought);
                        let expiry = shelf.zip(oldest).map(|(days, bought)| {
                            bought + chrono::Duration::minutes((days * 1440.0) as i64)
                        });
                        let step_to = expiry.filter(|expiry| *expiry < to).unwrap_or(to).max(at);
                        let mut need =
                            daily.quantity * (step_to - at).num_minutes() as f64 / 1440.0;
                        while need > 0.0 && !batches.is_empty() {
                            let used = need.min(batches[0].1);
                            batches[0].1 -= used;
                            need -= used;
                            if batches[0].1 <= 1e-9 {
                                batches.remove(0);
                            }
                        }
                        // Discard only the batch whose shelf life ended here.
                        if expiry.is_some_and(|expiry| expiry <= step_to)
                            && batches.first().map(|(bought, _)| *bought) == oldest
                        {
                            batches.remove(0);
                        }
                        at = step_to;
                    }
                    *clock = Some(to);
                };
                let anchor = anchors.get(id);
                if let Some((at, amounts)) = anchor {
                    let quantity = unit_of(amounts);
                    if quantity > 0.0 {
                        batches.push((*at, quantity));
                    }
                    peak = quantity;
                    clock = Some(*at);
                }
                let mut seen = anchor.is_some();
                // A purchase in another counted unit (a pack instead of the
                // usual piece) is taken as that many usual purchases, so it
                // still restocks the projection instead of being ignored.
                let usual = packages
                    .get(id)
                    .filter(|package| package.unit == daily.unit)
                    .map(|package| package.quantity);
                let bought_of = |amounts: &[Amount]| {
                    let direct = unit_of(amounts);
                    if direct > 0.0 {
                        return direct;
                    }
                    let counted = amounts
                        .iter()
                        .filter(|amount| !matches!(amount.unit.as_str(), "g" | "ml" | "dl" | "cl"))
                        .map(|amount| amount.quantity)
                        .sum::<f64>();
                    usual.map_or(0.0, |usual| counted * usual)
                };
                for (at, detail) in purchases.get(id).map(Vec::as_slice).unwrap_or(&[]) {
                    if anchor.is_some_and(|(since, _)| at <= since) {
                        continue;
                    }
                    let bought = bought_of(&event_amounts(detail));
                    if bought <= 0.0 {
                        continue;
                    }
                    advance(&mut batches, &mut clock, *at);
                    batches.push((*at, bought));
                    peak = peak.max(batches.iter().map(|(_, q)| q).sum());
                    seen = true;
                }
                if !seen {
                    // No evidence in this unit beyond the stored entry itself.
                    let start = recorded.iter().find(|amount| amount.unit == daily.unit)?;
                    batches.push((observed, start.quantity));
                    peak = start.quantity;
                    clock = Some(observed);
                }
                advance(&mut batches, &mut clock, now);
                let remaining = batches.iter().map(|(_, q)| q).sum::<f64>().max(0.0);
                let use_within = shelf.and_then(|days| {
                    batches
                        .first()
                        .map(|(bought, _)| days - (now - *bought).num_minutes() as f64 / 1440.0)
                });
                Some((remaining, peak, use_within))
            });
            let mut amounts = recorded.clone();
            let mut days_left = None;
            let mut level = None;
            let mut use_within = shelf
                .filter(|_| !recorded.is_empty())
                .map(|days| days - elapsed);
            if let (Some(daily), Some((remaining, peak, within))) = (&daily, tracked) {
                use_within = within;
                amounts.retain(|amount| amount.unit != daily.unit);
                if remaining > 0.0 {
                    amounts.push(Amount {
                        quantity: (remaining * 100.0).round() / 100.0,
                        unit: daily.unit.clone(),
                    });
                }
                days_left = Some((remaining / daily.quantity * 10.0).round() / 10.0);
                let reference = packages
                    .get(id)
                    .filter(|package| package.unit == daily.unit)
                    .map_or(peak, |package| {
                        package.quantity.max(peak.min(package.quantity * 2.0))
                    });
                level = (reference > 0.0).then(|| (remaining / reference).clamp(0.0, 1.0));
            }
            let expired = entry
                .expires_at
                .as_ref()
                .is_some_and(|expiry| expiry.as_str() < today.to_string().as_str());
            let use_within = use_within.map(|days| (days * 10.0).round() / 10.0);
            let status = if expired || use_within.is_some_and(|days| days < 0.0) {
                "expired"
            } else if days_left.is_some_and(|days| days < 0.5) {
                "out"
            } else if use_within.is_some_and(|days| days <= 1.5) {
                "expiring"
            } else {
                match days_left {
                    Some(days) if days < 0.5 => "out",
                    Some(days) if days <= horizon_days + 0.5 => "low",
                    Some(_) => "plenty",
                    None if recorded.is_empty() => "out",
                    None => "unknown",
                }
            };
            Some(StockEstimate {
                product_id: id.clone(),
                name: product.name,
                amounts,
                recorded,
                confirmed: entry.confirmed,
                observed_at: entry.observed_at.clone(),
                expires_at: entry.expires_at.clone(),
                runs_out_on: days_left.map(|days| {
                    (now + chrono::Duration::minutes((days * 1440.0) as i64))
                        .with_timezone(&zone)
                        .date_naive()
                        .to_string()
                }),
                use_within_days: use_within,
                daily_use: daily.filter(|_| tracked.is_some()),
                days_left,
                level,
                status: status.into(),
                rate_source: if tracked.is_some() {
                    rate.map_or("none", |(_, source)| source)
                } else {
                    "none"
                }
                .into(),
            })
        })
        .collect::<Vec<_>>();
    stock.sort_by(|a, b| {
        a.days_left
            .unwrap_or(f64::MAX)
            .total_cmp(&b.days_left.unwrap_or(f64::MAX))
            .then_with(|| a.name.cmp(&b.name))
    });
    stock
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
    let mut candidates = BTreeMap::<String, Value>::new();
    let mut habits = vec![];
    let mut rates = BTreeMap::<String, (ConsumptionRate, &'static str)>::new();
    let mut packages = BTreeMap::<String, Amount>::new();
    let mut last_bought = BTreeMap::<String, DateTime<Utc>>::new();
    let mut trip_days = std::collections::BTreeSet::<NaiveDate>::new();
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
        if let Some(rate) = effective {
            rates.insert(
                id.clone(),
                (
                    rate.clone(),
                    if manual.is_some() {
                        "manual"
                    } else {
                        "estimated"
                    },
                ),
            );
        }
        if let (Some(quantity), Some(unit)) =
            (package["quantity"].as_f64(), package["unit"].as_str())
        {
            packages.insert(
                id.clone(),
                crate::domain::normalize(&Amount {
                    quantity,
                    unit: unit.into(),
                }),
            );
        }
        last_bought.insert(id.clone(), *last);
        habits.push(json!({"productId":id,"name":product.name,"purchases":history.len(),"intervalDays":interval,"confidence":if intervals.len()>=5 {"established"}else if intervals.len()>=2 {"emerging"}else{"learning"},"lastBought":last,"estimatedConsumption":estimated,"consumptionRate":effective,"consumptionSource":if manual.is_some(){"manual"}else if estimated.is_some(){"estimated"}else{"learning"},"preferredNote":note,"quantity":package["quantity"],"unit":package["unit"],"storeId":store}));
        for (at, _) in history {
            let day = at.with_timezone(&zone);
            *weekdays.entry(day.weekday().to_string()).or_default() += 1;
            trip_days.insert(day.date_naive());
            baskets
                .entry(day.date_naive().to_string())
                .or_default()
                .push(id.clone());
        }
        if let Some(interval) = effective_interval
            && elapsed >= interval
            && suggestible(state, id, last)
        {
            candidates.insert(id.clone(), json!({"product":product,"quantity":package["quantity"],"unit":package["unit"],"note":note,"intervalDays":interval,"daysSince":elapsed,"confidence":if intervals.len()>=5 {"established"}else{"emerging"},"consumptionRate":effective,"consumptionSource":if configured_interval.is_some(){"manual"}else{"estimated"},"reason":if let Some(rate)=manual.filter(|_|configured_interval.is_some()) {format!("Your rate: {} {} every {} days; usually bought as {} {}. Last bought {} days ago. Worth checking.",rate.quantity,rate.unit,rate.days,package["quantity"],package["unit"].as_str().unwrap_or(""),elapsed)} else if manual.is_some() {format!("Usually bought about every {} days; last bought {} days ago. Your rate uses a different unit, so this suggestion follows purchase frequency. Worth checking.",interval,elapsed)} else {format!("Bought on {} separate days, usually about every {} days; last bought {} days ago. Worth checking.",days.len(),interval,elapsed)}}));
        }
    }
    let today = Utc::now().with_timezone(&zone).date_naive();
    let next_trip = next_shopping_day(&trip_days, today);
    let horizon = next_trip.map_or(3.0, |day| ((day - today).num_days() as f64).max(1.0));
    let mut anchors = BTreeMap::<String, (DateTime<Utc>, Vec<Amount>)>::new();
    for (at, detail) in conn
        .prepare("SELECT at,detail FROM events WHERE household_id=?1 AND kind='observePantry' AND undone=0 ORDER BY at")?
        .query_map(params![household], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))?
        .collect::<std::result::Result<Vec<_>, _>>()?
    {
        let detail: Value = serde_json::from_str(&detail)?;
        if let (Some(id), Ok(at)) = (detail["productId"].as_str(), DateTime::parse_from_rfc3339(&at)) {
            anchors.insert(id.into(), (at.with_timezone(&Utc), event_amounts(&detail)));
        }
    }
    let stock = project_stock(
        state,
        &rates,
        &packages,
        &purchases,
        &anchors,
        Utc::now(),
        zone,
        horizon,
    );
    for estimate in &stock {
        let id = &estimate.product_id;
        match estimate.status.as_str() {
            // A projection with enough left outranks a bare purchase interval.
            "plenty" if estimate.daily_use.is_some() => {
                candidates.remove(id);
            }
            "low" | "out" => {
                // Whatever was bought on the latest trip is what the household
                // chose for now: until it is projected used up, suggesting more
                // a day after buying it reads as a mistake.
                if estimate.status == "low"
                    && last_bought.get(id).is_some_and(|bought| {
                        (today - bought.with_timezone(&zone).date_naive()).num_days() <= 1
                    })
                {
                    continue;
                }
                let last = last_bought.get(id).copied().unwrap_or_else(|| {
                    DateTime::parse_from_rfc3339(&estimate.observed_at)
                        .map_or_else(|_| Utc::now(), |at| at.with_timezone(&Utc))
                });
                if !suggestible(state, id, &last) {
                    continue;
                }
                let Ok(product) = crate::domain::product(state, id) else {
                    continue;
                };
                let package = packages
                    .get(id)
                    .cloned()
                    .or_else(|| estimate.recorded.first().cloned());
                // Saved rates also apply to items never bought through the app.
                let Some((rate, source)) = rates
                    .get(id)
                    .map(|(rate, source)| (rate.clone(), *source))
                    .or_else(|| {
                        state
                            .consumption_rates
                            .get(id)
                            .map(|rate| (rate.clone(), "manual"))
                    })
                else {
                    continue;
                };
                let days_left = estimate.days_left.unwrap_or(0.0);
                let when = next_trip.map_or_else(String::new, |day| {
                    format!(" You usually shop on {}s.", weekday_name(day.weekday()))
                });
                let usage = format!(
                    "You use about {} {} every {} days.",
                    trim_number(rate.quantity),
                    rate.unit,
                    trim_number(rate.days)
                );
                let reason = if days_left < 0.5 {
                    format!("Probably used up by now. {usage}{when}")
                } else {
                    format!(
                        "About {} left, enough for {}. {usage}{when}",
                        amounts_label(&estimate.amounts),
                        days_label(days_left),
                    )
                };
                if let Some(existing) = candidates.get_mut(id) {
                    // Keep the interval explanation; add the projection.
                    existing["daysLeft"] = json!(estimate.days_left);
                    continue;
                }
                candidates.insert(id.clone(), json!({"product":product,"quantity":package.as_ref().map(|p| p.quantity),"unit":package.as_ref().map(|p| p.unit.clone()),"note":"","intervalDays":Value::Null,"daysSince":(Utc::now() - last).num_days(),"daysLeft":estimate.days_left,"confidence":if source == "manual" {"established"} else {"emerging"},"consumptionRate":rate,"consumptionSource":source,"reason":reason}));
            }
            _ => {}
        }
    }
    let mut restock = candidates.into_values().collect::<Vec<_>>();
    restock.sort_by(|a, b| {
        a["daysLeft"]
            .as_f64()
            .unwrap_or(f64::MAX)
            .total_cmp(&b["daysLeft"].as_f64().unwrap_or(f64::MAX))
    });
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
        json!({"restock":restock,"stock":stock,"nextShoppingDay":next_trip.map(|day| day.to_string()),"habits":habits,"shoppingDays":weekdays,"associations":associations.into_iter().take(12).map(|((a,b),count)|json!({"products":[a,b],"daysTogether":count})).collect::<Vec<_>>(),"purchaseCount":purchases.values().map(Vec::len).sum::<usize>()}),
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

    fn stock_state(amount: f64, unit: &str, confirmed: bool, observed: &str) -> HouseholdState {
        let mut state = crate::model::fresh_state(false, "UTC".into());
        state.pantry.insert(
            "milk".into(),
            PantryItem {
                amounts: vec![Amount {
                    quantity: amount,
                    unit: unit.into(),
                }],
                confirmed,
                observed_at: observed.into(),
                expires_at: None,
                note: String::new(),
            },
        );
        state
    }

    fn at(day: i64) -> DateTime<Utc> {
        purchase(day, 0.0, "").0
    }

    #[test]
    fn stock_replays_purchases_instead_of_accumulating_estimates() {
        // Stored estimates only ever add: 2 L every 3 days for 30 days reads
        // as 20 L. Replaying against 2 L / 3 days leaves about one carton.
        let state = stock_state(20000.0, "ml", false, "2026-09-28T12:00:00Z");
        let purchases = BTreeMap::from([(
            "milk".to_string(),
            (0..10)
                .map(|n| purchase(n * 3, 2.0, "L"))
                .collect::<Vec<_>>(),
        )]);
        let rates = BTreeMap::from([(
            "milk".to_string(),
            (
                ConsumptionRate {
                    quantity: 2.0,
                    unit: "L".into(),
                    days: 3.0,
                },
                "estimated",
            ),
        )]);
        let packages = BTreeMap::from([(
            "milk".to_string(),
            Amount {
                quantity: 2000.0,
                unit: "ml".into(),
            },
        )]);
        let now = at(28);
        let stock = project_stock(
            &state,
            &rates,
            &packages,
            &purchases,
            &BTreeMap::new(),
            now,
            chrono_tz::UTC,
            2.0,
        );
        let milk = &stock[0];
        assert_eq!(
            milk.amounts,
            vec![Amount {
                quantity: 1333.33,
                unit: "ml".into()
            }]
        );
        assert_eq!(milk.days_left, Some(2.0));
        assert_eq!(milk.status, "low");
        assert_eq!(milk.rate_source, "estimated");
        assert!((milk.level.unwrap() - 0.667).abs() < 0.01);
        // Three days later it is projected to be gone.
        let later = project_stock(
            &state,
            &rates,
            &packages,
            &purchases,
            &BTreeMap::new(),
            at(31),
            chrono_tz::UTC,
            2.0,
        );
        assert_eq!(later[0].status, "out");
        assert!(later[0].amounts.is_empty());
    }

    #[test]
    fn a_purchase_in_another_counted_unit_counts_as_usual_purchases() {
        // Bread usually bought as 1 pc, then once as 2 packs: the packs still
        // restock it instead of leaving the old pieces running out.
        let state = stock_state(2.0, "pack", false, "2026-09-09T12:00:00Z");
        let purchases = BTreeMap::from([(
            "milk".to_string(),
            vec![
                purchase(0, 1.0, "pc"),
                purchase(2, 1.0, "pc"),
                purchase(4, 1.0, "pc"),
                purchase(6, 2.0, "pack"),
                purchase(6, 500.0, "g"),
            ],
        )]);
        let rates = BTreeMap::from([(
            "milk".to_string(),
            (
                ConsumptionRate {
                    quantity: 1.0,
                    unit: "pc".into(),
                    days: 2.0,
                },
                "estimated",
            ),
        )]);
        let packages = BTreeMap::from([(
            "milk".to_string(),
            Amount {
                quantity: 1.0,
                unit: "pc".into(),
            },
        )]);
        let project = |packages| {
            project_stock(
                &state,
                &rates,
                packages,
                &purchases,
                &BTreeMap::new(),
                at(6),
                chrono_tz::UTC,
                2.0,
            )
        };
        // 2 packs + 500 g count as 2 usual pieces; weights are never guessed.
        assert_eq!(project(&packages)[0].days_left, Some(4.0));
        assert_eq!(project(&packages)[0].status, "plenty");
        // Without a usual purchase in the rate's unit there is no conversion.
        assert_eq!(project(&BTreeMap::new())[0].days_left, Some(0.0));
    }

    #[test]
    fn confirmed_observations_anchor_the_projection_and_plain_entries_stay_unknown() {
        let state = stock_state(1500.0, "ml", true, "2026-09-11T12:00:00Z");
        let purchases = BTreeMap::from([(
            "milk".to_string(),
            vec![purchase(0, 2.0, "L"), purchase(12, 1.0, "L")],
        )]);
        let anchors = BTreeMap::from([(
            "milk".to_string(),
            (
                at(10),
                vec![Amount {
                    quantity: 1500.0,
                    unit: "ml".into(),
                }],
            ),
        )]);
        let rates = BTreeMap::from([(
            "milk".to_string(),
            (
                ConsumptionRate {
                    quantity: 500.0,
                    unit: "ml".into(),
                    days: 1.0,
                },
                "manual",
            ),
        )]);
        // 1.5 L at day 10, -1 L by day 12, +1 L, -1 L by day 14 → 0.5 L.
        let stock = project_stock(
            &state,
            &rates,
            &BTreeMap::new(),
            &purchases,
            &anchors,
            at(14),
            chrono_tz::UTC,
            3.0,
        );
        assert_eq!(
            stock[0].amounts,
            vec![Amount {
                quantity: 500.0,
                unit: "ml".into()
            }]
        );
        assert_eq!(stock[0].days_left, Some(1.0));
        assert_eq!(stock[0].rate_source, "manual");
        let untracked = project_stock(
            &state,
            &BTreeMap::new(),
            &BTreeMap::new(),
            &purchases,
            &anchors,
            at(14),
            chrono_tz::UTC,
            3.0,
        );
        assert_eq!(untracked[0].status, "unknown");
        assert_eq!(untracked[0].days_left, None);
        assert_eq!(untracked[0].amounts, untracked[0].recorded);
    }

    fn slow_milk(per_day_ml: f64) -> BTreeMap<String, (ConsumptionRate, &'static str)> {
        BTreeMap::from([(
            "milk".to_string(),
            (
                ConsumptionRate {
                    quantity: per_day_ml,
                    unit: "ml".into(),
                    days: 1.0,
                },
                "manual",
            ),
        )])
    }

    #[test]
    fn shelf_life_flags_ageing_batches_and_discards_spoiled_ones() {
        let mut state = stock_state(2000.0, "ml", false, "2026-09-01T12:00:00Z");
        state.shelf_life_days.insert("milk".into(), 5.0);
        let purchases = BTreeMap::from([("milk".to_string(), vec![purchase(0, 2.0, "L")])]);
        let project = |day: i64| {
            project_stock(
                &state,
                &slow_milk(1000.0 / 7.0),
                &BTreeMap::new(),
                &purchases,
                &BTreeMap::new(),
                at(day),
                chrono_tz::UTC,
                2.0,
            )
            .remove(0)
        };
        let ageing = project(4);
        assert_eq!(ageing.status, "expiring");
        assert_eq!(ageing.use_within_days, Some(1.0));
        assert_eq!(
            ageing.amounts,
            vec![Amount {
                quantity: 1428.57,
                unit: "ml".into()
            }]
        );
        let spoiled = project(6);
        assert_eq!(
            spoiled.status, "out",
            "a carton past its shelf life is gone"
        );
        assert!(spoiled.amounts.is_empty());
        assert_eq!(spoiled.use_within_days, None);
    }

    #[test]
    fn shelf_life_uses_the_oldest_batch_first() {
        let mut state = stock_state(2000.0, "ml", false, "2026-09-04T12:00:00Z");
        state.shelf_life_days.insert("milk".into(), 5.0);
        let purchases = BTreeMap::from([(
            "milk".to_string(),
            vec![purchase(0, 1.0, "L"), purchase(3, 1.0, "L")],
        )]);
        // Days 0–5 drink 500 ml from the first carton; its other half spoils
        // on day 5, and day 6 drinks 100 ml from the second carton.
        let milk = project_stock(
            &state,
            &slow_milk(100.0),
            &BTreeMap::new(),
            &purchases,
            &BTreeMap::new(),
            at(6),
            chrono_tz::UTC,
            2.0,
        )
        .remove(0);
        assert_eq!(
            milk.amounts,
            vec![Amount {
                quantity: 900.0,
                unit: "ml".into()
            }]
        );
        assert_eq!(milk.use_within_days, Some(2.0));
        assert_eq!(milk.status, "plenty");
        // Untracked items still get an age warning from the stored entry.
        let mut plain = stock_state(1.0, "pc", false, "2026-09-01T12:00:00Z");
        plain.shelf_life_days.insert("milk".into(), 3.0);
        let old = project_stock(
            &plain,
            &BTreeMap::new(),
            &BTreeMap::new(),
            &BTreeMap::new(),
            &BTreeMap::new(),
            at(5),
            chrono_tz::UTC,
            2.0,
        );
        assert_eq!(old[0].status, "expired");
        assert_eq!(old[0].use_within_days, Some(-2.0));
    }

    #[test]
    fn next_shopping_day_follows_regular_weekdays() {
        let day = |text: &str| chrono::NaiveDate::parse_from_str(text, "%Y-%m-%d").unwrap();
        // Saturdays mostly, Wednesdays sometimes, one stray Monday.
        let trips = [
            "2026-09-05",
            "2026-09-12",
            "2026-09-19",
            "2026-09-26",
            "2026-09-09",
            "2026-09-23",
            "2026-09-14",
        ]
        .map(day)
        .into_iter()
        .collect();
        // From Sunday 27 Sep the next regular day is Wednesday, not Monday.
        assert_eq!(
            next_shopping_day(&trips, day("2026-09-27")),
            Some(day("2026-09-30"))
        );
        assert_eq!(
            next_shopping_day(&trips, day("2026-09-30")),
            Some(day("2026-10-03"))
        );
        let few = ["2026-09-05", "2026-09-12"].map(day).into_iter().collect();
        assert_eq!(next_shopping_day(&few, day("2026-09-27")), None);
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
