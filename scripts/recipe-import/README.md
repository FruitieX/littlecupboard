# Family meal candidate import

`family-meals.py` builds a household-specific compare-and-set patch from a current
state snapshot. Submit the resulting operation through the authenticated
`POST /api/operations` endpoint with a fresh UUID. The endpoint validates and
commits the entire patch transactionally, records undo history, and broadcasts it.
Never update the live household snapshot directly.

```sh
nix develop --command sh -c 'python3 scripts/recipe-import/family-meals.py /tmp/current-state.json > /tmp/meal-operation.json'
```

The import follows the existing English library language. Nine stable recipe IDs
make subsequent imports no-ops; existing spinach pancakes receive additive
serving notes and a pan-fried variation without changing the original recipe.
The original macaroni casserole stays separate. Recipes become selectable but
no schedule is created. Active time, difficulty, substitutions, optional extras,
and serving/storage notes use existing text fields. Only required ingredients
enter shopping requirements. The API scales their quantities with servings.

The input must contain the existing Spinach pancakes recipe and catalog entries
named Tomatoes, Water and Basil. Their existing IDs are resolved by name; all
other ingredients use built-in catalog IDs. One missing oat cooking product is
added to Dairy (or Ingredients). Inspect a household's catalog for an equivalent
before using this import elsewhere. Optional ingredients are described in notes
because the schema has no optional-ingredient flag.

Recipe images must be private `/api/images/…` uploads, not external URLs.
Wikimedia Commons candidate metadata was reachable during preparation, but image
downloads returned HTTP 403, so no external photograph or unverified attribution
is attached by this import. Existing spinach pancake photography is retained.

Accidental deletion recovery is separate: retrieve the exact recipe from the
household's deletion event and insert it via the same patch mechanism only when
its original ID is absent. Do not restore a whole historical household backup.
