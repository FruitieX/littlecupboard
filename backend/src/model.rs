use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use ts_rs::TS;

#[derive(Clone, Debug, Default, Deserialize, Serialize, TS, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export, export_to = "../../src/lib/api/")]
pub struct Amount {
    pub quantity: f64,
    pub unit: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, TS, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export, export_to = "../../src/lib/api/")]
pub struct ConsumptionRate {
    pub quantity: f64,
    pub unit: String,
    pub days: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize, TS, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export, export_to = "../../src/lib/api/")]
pub struct Product {
    pub id: String,
    pub name: String,
    pub category: String,
    pub icon: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub image: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub interval: Option<f64>,
    #[serde(default)]
    pub aliases: Vec<String>,
    /// Bought once: hidden from the catalog and deleted with its list entry
    /// once the trip is finished, without touching the cupboard.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub one_off: Option<bool>,
    /// Default note for whoever is shopping, filled in when the item goes
    /// on the list without one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub description: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, TS, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export, export_to = "../../src/lib/api/")]
pub struct PlanCredit {
    pub day: String,
    pub product_id: String,
    pub quantity: f64,
    pub unit: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, TS, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export, export_to = "../../src/lib/api/")]
pub struct ShoppingItem {
    pub id: String,
    pub name: String,
    pub category: String,
    pub icon: String,
    pub quantity: f64,
    pub unit: String,
    pub note: String,
    pub checked: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub image: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub interval: Option<f64>,
    #[serde(default)]
    pub aliases: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub origin: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub plan_credits: Option<Vec<PlanCredit>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub checked_before: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub manual_amount: Option<Amount>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub amounts: Option<Vec<Amount>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub one_off: Option<bool>,
}

#[derive(Clone, Debug, Deserialize, Serialize, TS, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export, export_to = "../../src/lib/api/")]
pub struct Ingredient {
    pub product_id: String,
    pub quantity: f64,
    pub unit: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub note: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, TS, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export, export_to = "../../src/lib/api/")]
pub struct Recipe {
    pub id: String,
    pub name: String,
    pub subtitle: String,
    pub image: String,
    pub minutes: u32,
    pub tag: String,
    pub servings: f64,
    pub ingredients: Vec<Ingredient>,
    pub steps: Vec<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[ts(as = "Option<Vec<SourceImage>>", optional)]
    pub source_images: Vec<SourceImage>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub favorite: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub meal_plan_eligible: Option<bool>,
}

#[derive(Clone, Debug, Deserialize, Serialize, TS, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export, export_to = "../../src/lib/api/")]
pub struct SourceImage {
    pub url: String,
    pub name: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, TS, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export, export_to = "../../src/lib/api/")]
pub struct Store {
    pub id: String,
    pub name: String,
    pub location: String,
    pub order: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub image: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub position: Option<GeoPoint>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, TS, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export, export_to = "../../src/lib/api/")]
pub struct GeoPoint {
    pub lat: f64,
    pub lng: f64,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, TS, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export, export_to = "../../src/lib/api/")]
pub struct PantryItem {
    pub amounts: Vec<Amount>,
    pub confirmed: bool,
    pub observed_at: String,
    pub expires_at: Option<String>,
    pub note: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, TS, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export, export_to = "../../src/lib/api/")]
pub struct MealFeedback {
    pub recipe_id: String,
    pub status: String,
    pub servings: f64,
    pub at: String,
    pub rating: Option<u8>,
    pub consumed: bool,
    /// Recorded by the daily routine that uses a planned meal's ingredients;
    /// the family can still mark the meal skipped or rate it.
    #[serde(default)]
    pub automatic: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, TS, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export, export_to = "../../src/lib/api/")]
pub struct SuggestionFeedback {
    pub status: String,
    pub until: Option<String>,
    pub at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, TS, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export, export_to = "../../src/lib/api/")]
pub struct Preferences {
    pub time_zone: String,
    pub servings: f64,
    pub dietary: Vec<String>,
    pub avoid: Vec<String>,
    pub novelty: f64,
    pub max_weekday_minutes: u32,
    pub auto_restock: bool,
}
impl Default for Preferences {
    fn default() -> Self {
        Self {
            time_zone: "Europe/Helsinki".into(),
            servings: 4.0,
            dietary: vec![],
            avoid: vec![],
            novelty: 0.25,
            max_weekday_minutes: 35,
            auto_restock: false,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, TS, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export, export_to = "../../src/lib/api/")]
pub struct HouseholdState {
    pub items: Vec<ShoppingItem>,
    pub stores: Vec<Store>,
    pub store_id: String,
    pub plan: BTreeMap<String, String>,
    pub purchases: BTreeMap<String, String>,
    pub custom_products: Vec<Product>,
    pub custom_recipes: Vec<Recipe>,
    pub favorite_recipe_ids: Vec<String>,
    pub plan_coverage: BTreeMap<String, BTreeMap<String, Vec<Amount>>>,
    #[serde(default)]
    pub purchased_coverage: BTreeMap<String, BTreeMap<String, Vec<Amount>>>,
    pub recipe_book: Vec<Recipe>,
    pub groups: Vec<String>,
    pub pantry: BTreeMap<String, PantryItem>,
    pub servings: BTreeMap<String, f64>,
    pub meal_feedback: BTreeMap<String, MealFeedback>,
    pub suggestion_feedback: BTreeMap<String, SuggestionFeedback>,
    pub preferences: Preferences,
    #[serde(default)]
    pub product_images: BTreeMap<String, String>,
    #[serde(default)]
    pub product_groups: BTreeMap<String, String>,
    #[serde(default)]
    pub product_details: BTreeMap<String, Product>,
    #[serde(default)]
    pub archived_product_ids: Vec<String>,
    #[serde(default)]
    pub consumption_rates: BTreeMap<String, ConsumptionRate>,
    /// Optional days an item keeps after buying, e.g. about 7 for milk.
    #[serde(default)]
    pub shelf_life_days: BTreeMap<String, f64>,
    /// Private photos the family took of an item, kept for later use.
    #[serde(default)]
    pub item_photos: BTreeMap<String, Vec<String>>,
    /// Items a photo job added, marked until a family member approves them:
    /// `list`, `bought` or `pantry`.
    #[serde(default)]
    pub ai_added: BTreeMap<String, String>,
}

#[derive(Clone, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/api/")]
pub struct Member {
    pub id: String,
    pub name: String,
    pub email: String,
    pub role: String,
}

#[derive(Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/api/")]
pub struct SessionInfo {
    pub user: Member,
    pub household_id: String,
    pub household_name: String,
    pub members: Vec<Member>,
    pub ai_enabled: bool,
    pub image_enabled: bool,
}

#[derive(Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/api/")]
pub struct Snapshot {
    pub revision: u32,
    pub state: HouseholdState,
}

#[derive(Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export, export_to = "../../src/lib/api/")]
pub struct Change {
    pub collection: String,
    pub key: String,
    pub field: Option<String>,
    pub before: serde_json::Value,
    pub after: serde_json::Value,
}

#[derive(Clone, Serialize, Deserialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
#[ts(export, export_to = "../../src/lib/api/")]
pub enum Operation {
    Patch {
        changes: Vec<Change>,
        label: String,
    },
    CheckItem {
        id: String,
        checked: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        expected: Option<Box<ShoppingItem>>,
    },
    AddItem {
        product_id: String,
        quantity: f64,
        unit: String,
        note: String,
        accumulate: bool,
    },
    AddIngredients {
        ingredients: Vec<Ingredient>,
        multiplier: f64,
    },
    RemoveItem {
        id: String,
    },
    EditItem {
        id: String,
        quantity: f64,
        unit: String,
        category: String,
        note: String,
        expected: Box<ShoppingItem>,
    },
    MealFeedback {
        day: String,
        recipe_id: String,
        status: String,
        consume: bool,
        rating: Option<u8>,
    },
    FinishTrip,
    ObservePantry {
        product_id: String,
        quantity: f64,
        unit: String,
        expires_at: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        amounts: Option<Vec<Amount>>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        note: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        expected: Option<Box<PantryItem>>,
    },
    Undo {
        event_id: String,
    },
    ResetHistory,
    ApplyProposal {
        proposal_id: String,
        shopping_indices: Vec<usize>,
        recipe_ids: Vec<String>,
        days: Vec<String>,
    },
}

#[derive(Clone, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export, export_to = "../../src/lib/api/")]
pub struct Mutation {
    pub id: String,
    pub operation: Operation,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub store_id: Option<String>,
}

#[derive(Clone, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/api/")]
pub struct HistoryEvent {
    pub id: String,
    pub actor: String,
    pub kind: String,
    pub at: String,
    pub detail: serde_json::Value,
    pub undone: bool,
}

#[derive(Deserialize)]
pub struct Seed {
    pub catalog: Vec<Product>,
    pub recipes: Vec<Recipe>,
    pub categories: Vec<String>,
    #[serde(rename = "artworkAliases")]
    pub artwork_aliases: BTreeMap<String, String>,
    /// Approximate built-in shelf lives in days, keyed by product id.
    #[serde(default, rename = "shelfLife")]
    pub shelf_life: BTreeMap<String, f64>,
}

/// The bundled catalog, parsed once. Product lookups run inside request
/// handlers while the database lock is held, so never reparse per call.
pub fn seed() -> &'static Seed {
    static SEED: std::sync::LazyLock<Seed> = std::sync::LazyLock::new(|| {
        serde_json::from_str(include_str!("../seed.json")).expect("valid compiled seed catalog")
    });
    &SEED
}
pub fn fresh_state(samples: bool, time_zone: String) -> HouseholdState {
    let seed = seed();
    HouseholdState {
        items: vec![],
        stores: vec![Store {
            id: "our-store".into(),
            name: "Our shop".into(),
            image: None,
            position: None,
            location: "".into(),
            order: seed.categories.clone(),
        }],
        store_id: "our-store".into(),
        plan: BTreeMap::new(),
        purchases: BTreeMap::new(),
        custom_products: vec![],
        custom_recipes: vec![],
        favorite_recipe_ids: vec![],
        plan_coverage: BTreeMap::new(),
        purchased_coverage: BTreeMap::new(),
        recipe_book: if samples {
            seed.recipes.clone()
        } else {
            vec![]
        },
        groups: seed.categories.clone(),
        pantry: BTreeMap::new(),
        servings: BTreeMap::new(),
        meal_feedback: BTreeMap::new(),
        suggestion_feedback: BTreeMap::new(),
        preferences: Preferences {
            time_zone,
            ..Preferences::default()
        },
        product_images: BTreeMap::new(),
        product_groups: BTreeMap::new(),
        product_details: BTreeMap::new(),
        archived_product_ids: vec![],
        consumption_rates: BTreeMap::new(),
        shelf_life_days: BTreeMap::new(),
        item_photos: BTreeMap::new(),
        ai_added: BTreeMap::new(),
    }
}

/// Best-effort projection of what remains at home. `amounts` subtracts the
/// effective consumption rate since the last observation; `recorded` is the
/// stored pantry amount. Nothing here changes meal coverage.
#[derive(Clone, Debug, Serialize, TS, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/api/")]
pub struct StockEstimate {
    pub product_id: String,
    pub name: String,
    pub amounts: Vec<Amount>,
    pub recorded: Vec<Amount>,
    pub confirmed: bool,
    pub observed_at: String,
    pub expires_at: Option<String>,
    pub daily_use: Option<Amount>,
    pub days_left: Option<f64>,
    pub runs_out_on: Option<String>,
    /// Days until the oldest remaining purchase passes its shelf life.
    pub use_within_days: Option<f64>,
    /// Remaining share of a usual purchase, 0–1, when it can be compared.
    pub level: Option<f64>,
    /// `plenty`, `low`, `out`, `expiring`, `expired` or `unknown`.
    pub status: String,
    /// `manual`, `estimated` or `none`.
    pub rate_source: String,
}

#[derive(Clone, Debug, Serialize, TS, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/api/")]
pub struct NamedCount {
    pub id: String,
    pub name: String,
    pub count: u32,
}

#[derive(Clone, Debug, Serialize, TS, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/api/")]
pub struct WeekStat {
    pub week_start: String,
    pub items: u32,
    pub trips: u32,
}

#[derive(Clone, Debug, Serialize, TS, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/api/")]
pub struct ProductStat {
    pub product_id: String,
    pub name: String,
    pub count: u32,
    pub interval_days: Option<i64>,
    pub last_bought: String,
}

#[derive(Clone, Debug, Serialize, TS, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/api/")]
pub struct RecipeStat {
    pub recipe_id: String,
    pub name: String,
    pub cooked: u32,
    pub skipped: u32,
    pub rating: Option<f64>,
    pub last_cooked: Option<String>,
}

#[derive(Clone, Debug, Serialize, TS, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/api/")]
pub struct HouseholdStats {
    pub purchases: u32,
    pub trips: u32,
    pub distinct_products: u32,
    pub average_trip_items: Option<f64>,
    pub average_trip_minutes: Option<f64>,
    pub median_days_between_trips: Option<i64>,
    pub since: Option<String>,
    /// The last twelve weeks, oldest first, starting on Mondays.
    pub weeks: Vec<WeekStat>,
    /// Shopping days per weekday, Monday first.
    pub weekdays: Vec<u32>,
    /// Checked items per local hour of day.
    pub hours: Vec<u32>,
    pub top_products: Vec<ProductStat>,
    pub groups: Vec<NamedCount>,
    pub stores: Vec<NamedCount>,
    pub shoppers: Vec<NamedCount>,
    pub meals_cooked: u32,
    pub meals_skipped: u32,
    pub top_recipes: Vec<RecipeStat>,
    /// Bought before, not for at least three usual intervals.
    pub lapsed: Vec<ProductStat>,
}
