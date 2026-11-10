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
before using this import elsewhere. This original import describes optional ingredients in notes; later imports can
use structured option groups.

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

## Family candidates, selectable components and variants

`batch2.json` defines 13 additional Finnish-titled candidate meals: Pirkka Parhaat
chicken nuggets with rice, fish balls with mash, homemade chicken nuggets, IKEA
plant balls, vegetarian meatball pasta, creamy Quorn pasta, Quorn with wedges,
tofu nuggets, tofu stir-fry, mild coconut tofu, vegetable omelette, Apetit plant
nuggets, and plant-based wraps. Exact branded products are retained separately
from generic ingredients; the Pirkka Parhaat product must not be replaced with
regular Pirkka nuggets. Product and inspiration references live in the manifest.
Use current package instructions and labels if products change.

Run `batch2.py API_ORIGIN [PRIVATE_SAUCE_IMAGE]` with an authenticated session token
on stdin after installing the supporting app version. It resolves existing
catalog names/aliases, rejects ambiguous matches, uploads local photos through
`/api/images`, and submits one validated compare-and-set API patch. Stable IDs
make repeat runs no-ops; retrying the same mutation is idempotent. Existing recipe
ingredients, directions, photos, references and portions are preserved. Five
existing candidates receive additive variant/batch metadata or the optional
fish-sticks sauce. Preferences, favorites, usage history and meal plans are not
changed. The optional sauce source image is a private attachment, never a public
asset. The import assumes the catalog entries used by the earlier candidate
batch, including its oat cooking product.

Optional groups start off; required groups default to their first choice. A
choice holds scalable ingredient amounts and extra ordered cooking steps. The
fish-sticks dip selects exactly one flavor (including mustard cucumber relish),
never all flavors together. Planned selections are stored per date and used by
both shopping requirements and meal consumption. Catalog deletion checks include
all selectable ingredients. Related complete recipes share a variant group;
switching a variant opens that recipe without rewriting either version.

Recipes support kid approval, meal category, leftovers suitability and variant
metadata. Favorites sort first by default; most-used ordering counts actual new
planning and manual recipe-shopping actions. Earlier activity is not guessed or
backfilled. Recommended ordering and lunch suggestions use weekly fish,
vegetarian and meat variety, preferences, repeats and kid approval. This is a
variety heuristic, not nutrient analysis. Suggestions fill future open days only.
A leftover suggestion requires an explicitly prepared extra batch on the previous
day; it adds neither another grocery requirement nor another pantry deduction.
Suggested new recipes are independent complete drafts, reviewed before saving.

### Generated image assets

These are generated illustrative meal photos, not photographs of the branded
products. All are uploaded and cached as private SQLite attachments at import;
recipe cards do not depend on external photo hosting. Full built-in image_gen
prompts: [batch2-prompts.json](batch2-prompts.json).

- [coconut-tofu](batch2-images/coconut-tofu.jpg)
- [diy-chicken-nuggets](batch2-images/diy-chicken-nuggets.jpg)
- [fish-balls-mash](batch2-images/fish-balls-mash.jpg)
- [ikea-plant-balls](batch2-images/ikea-plant-balls.jpg)
- [pirkka-nuggets-rice](batch2-images/pirkka-nuggets-rice.jpg)
- [plant-nuggets](batch2-images/plant-nuggets.jpg)
- [plant-wraps](batch2-images/plant-wraps.jpg)
- [quorn-pasta](batch2-images/quorn-pasta.jpg)
- [quorn-wedges](batch2-images/quorn-wedges.jpg)
- [tofu-nuggets](batch2-images/tofu-nuggets.jpg)
- [tofu-stir-fry](batch2-images/tofu-stir-fry.jpg)
- [vegetable-omelette](batch2-images/vegetable-omelette.jpg)
- [veggie-meatball-pasta](batch2-images/veggie-meatball-pasta.jpg)
