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

Recipe images are private `/api/images/…` uploads. After applying the recipe
patch, `attach-photos.py API_ORIGIN` reads an authenticated session token from
stdin, uploads the reviewed Commons thumbnails and commits missing image fields
in one undoable transaction. Existing images are never replaced. Re-running it
when all photos exist makes no uploads or mutations. Keep credentials out of
shell arguments and files.

`photos.json` retains source pages, authors, licenses and visual-match notes.
These are illustrative photos, not claims that the pictured dishes used the
saved recipe. Provenance stays with the import data; recipe descriptions stay
focused on cooking. Actual recipe-source links belong in descriptions when a
recipe was adapted from a known URL. These candidates were supplied directly,
so there is no original recipe URL to attach. Photo pages are not recipe sources.

Send the same `LittleCupboard/1.0` User-Agent when requesting both Wikimedia
metadata and image bytes. Anonymous/default Python image requests returned 403;
the consistent application header worked for both thumbnails and originals.

Accidental deletion recovery is separate: retrieve the exact recipe from the
household's deletion event and insert it via the same patch mechanism only when
its original ID is absent. Do not restore a whole historical household backup.
