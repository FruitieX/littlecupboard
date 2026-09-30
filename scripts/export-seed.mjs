import { writeFile } from 'node:fs/promises'
import { catalog, recipes, categories } from '../src/lib/data.ts'
await writeFile(
  'backend/seed.json',
  JSON.stringify({ catalog, recipes, categories }, null, 2) + '\n',
)
