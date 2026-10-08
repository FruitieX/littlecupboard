import type { AppState, Product, Recipe } from './data'
import { getProducts } from './catalog'
import { recipeTags } from './recipe-tags'

/** Lowercase without accents, so "creme" finds "crème" and "Ä" finds "a". */
export function normalizeSearch(text: string) {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

/** Every typed word must appear in at least one of the fields. */
export function matchesSearch(
  fields: (string | undefined | null)[],
  query: string,
) {
  const words = normalizeSearch(query).split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const haystack = fields
    .filter(Boolean)
    .map((field) => normalizeSearch(field!))
  return words.every((word) => haystack.some((field) => field.includes(word)))
}

/** Searchable text for an item: names, group and notes the family wrote. */
export function productSearchFields(state: AppState, product: Product) {
  return [
    product.name,
    product.category,
    ...(product.aliases ?? []),
    state.items.find((item) => item.id === product.id)?.note,
    state.pantry?.[product.id]?.note,
  ]
}

/** Searchable text for a recipe: name, description, tags and ingredients. */
export function recipeSearchFields(state: AppState, recipe: Recipe) {
  const products = getProducts(state)
  return [
    recipe.name,
    recipe.subtitle,
    ...recipeTags(recipe),
    ...recipe.ingredients.flatMap((ingredient) => {
      const product = products.find((p) => p.id === ingredient.productId)
      return [product?.name, ...(product?.aliases ?? []), ingredient.note]
    }),
  ]
}
