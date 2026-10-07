import { writeFile } from 'node:fs/promises'
import { catalog, recipes, categories } from '../src/lib/data.ts'
import { catalogArtworkAliases } from '../src/lib/catalog-artwork.ts'
import { defaultShelfLifeDays } from '../src/lib/shelf-life.ts'
await writeFile(
  'backend/seed.json',
  JSON.stringify(
    {
      catalog,
      recipes,
      categories,
      artworkAliases: catalogArtworkAliases,
      shelfLife: defaultShelfLifeDays,
    },
    null,
    2,
  ) + '\n',
)
