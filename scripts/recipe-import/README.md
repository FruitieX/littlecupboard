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

## Original recipe references

Recipes support an optional `sourceUrl`, separate from `image` and source-image
attachments. The editor accepts HTTP(S) URLs and recipe details show a reference
link. Backups retain it; legacy recipes need no migration because household
recipes are serialized JSON with an optional field.

`sources.json` maps the ten existing candidates to the supplied original recipe
references and records the reviewed image decisions. After the supporting app
version is running, `attach-sources.py API_ORIGIN` reads a session token from
stdin and submits a transactional patch. It updates references and four matching
source photos, preserving all ingredients, steps, servings, preferences and
plans. The optional homemade fish-finger reference is appended to that recipe's
notes. Every replacement image is downloaded and uploaded to SQLite through
`/api/images`; no external image URL is used to display a recipe. Repeating the
import after success makes no uploads or changes.

The replacement source photos are household attachments only. They are not
bundled in this repository or distributed as public application assets.

The oven salmon and fish sticks images are generated illustrations in a
photorealistic style, stored under `images/`. Their full generation prompts are
in `image-prompts.json` (built-in image_gen). The photo manifest uses these local
assets for missing images; it never replaces an existing household attachment.
The recipe title uses “Fish sticks” while retaining the existing catalog IDs.

`roast-chicken.json` is an additional four-portion candidate with a whole-chicken
catalog entry, a source reference and a generated image. Reuse an equivalent
whole-chicken catalog entry if one exists, upload the local PNG through
`/api/images`, then insert the product (if missing) and recipe as one API patch.
Its stable recipe ID makes an existing import a no-op. Oven timing is separate
from the ready-cooked shortcut; neither changes the weekly plan.
