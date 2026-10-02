import { writeFile } from 'node:fs/promises'
import { catalog, recipes, categories } from '../src/lib/data.ts'
import { catalogArtworkAliases } from '../src/lib/catalog-artwork.ts'
await writeFile(
  'backend/seed.json',
  JSON.stringify(
    { catalog, recipes, categories, artworkAliases: catalogArtworkAliases },
    null,
    2,
  ) + '\n',
)
