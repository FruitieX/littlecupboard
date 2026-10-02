# Catalog artwork

Every one of the 333 built-in products has an explicitly reviewed image, without
deleting products or changing their identities. The catalog uses 207 generated
icons and 59 appropriate Twemoji illustrations. An additional generated grated
cheese icon and exact-name aliases cover existing custom water, basil and cheese
items. Household photos and deliberately chosen custom emoji take priority.
Old shopping entries inherit defaults on display without rewriting their saved
quantities, purchase history or image associations.

Generated assets live in `public/images/catalog/generated/`. They are 256×256
WebP at quality 0.92 with real alpha and empty padding. The 208 files total about
1.75 MB, averaging 8.4 KB. They work at the app's 48–56 px tile sizes and are
bundled into the offline shell. Recipe photos and private uploads remain separate.

`catalog-batches.json` records each subject's row-major sheet position and product
assignments. Thirteen 4×4 sheets yielded 206 retained illustrations; two unused
variants were discarded. A herb sheet needed regeneration for legible dill.
Mussels and grated cheese were generated individually. `generation-prompts.json`
contains the actual accepted prompts, built-in `image_gen` provenance and source
PNG hashes. Generation used the current Codex session, without accessing the
application's API or companion credentials.

Batching works for simple, distinct subjects, but requires visual review. Cell
placement can drift and fine herbs can become indistinct. The extraction script
assigns connected foreground shapes to the cell containing their center, keeps
immediate antialias edges and crops with padding. This prevents neighboring
objects leaking into an icon when an illustration crosses the nominal grid.
Always inspect the labeled preview and correct subject errors with generation.

Existing and added vector illustrations are from
[Twemoji v14.0.2](https://github.com/twitter/twemoji/tree/v14.0.2/assets/svg),
under the [bundled graphics license](../../public/images/food/LICENSE-GRAPHICS.txt).
`catalog-vectors.json` contains the product assignments; `catalog-aliases.json`
contains exact-name defaults for generic custom placeholders. Aliases never
replace private photos or a chosen non-placeholder icon.

To extract an accepted sheet or individual replacement:

```sh
nix develop --command node scripts/split-icon-sheet.mjs 1 /path/to/reviewed-sheet.png
nix develop --command node scripts/build-catalog-artwork.mjs
nix develop --command node scripts/export-seed.mjs
nix develop --command node scripts/render-catalog-artwork.mjs
```

The generated TypeScript registry and Rust seed are committed. CI verifies that
they agree with the manifests, every product and alias has its asset, and raster
icons have the expected dimensions, transparent background and clear borders.
[Catalog preview](catalog-preview.png) shows all items at 48 px on tile backgrounds.
