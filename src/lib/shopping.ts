import type {
  AppState,
  Ingredient,
  Product,
  Recipe,
  ShoppingItem,
} from './data'
import { catalog } from './data'

export function mergeItem(
  items: ShoppingItem[],
  product: Product,
  quantity = 1,
  unit = 'pc',
  note = '',
  accumulate = false,
): ShoppingItem[] {
  const existing = items.find((item) => item.id === product.id)
  if (!existing)
    return [...items, { ...product, quantity, unit, note, checked: false }]
  return items.map((item) => {
    if (item.id !== product.id) return item
    const notes = [item.note, note].filter(Boolean)
    // Incompatible units remain explicit instead of silently adding unlike quantities.
    if (accumulate && !item.checked && item.unit !== unit)
      notes.push(`${quantity} ${unit}`)
    return {
      ...item,
      checked: false,
      quantity: item.checked
        ? quantity
        : accumulate && item.unit === unit
          ? item.quantity + quantity
          : item.quantity,
      unit: item.checked ? unit : item.unit,
      note: [...new Set(notes)].join(' · '),
    }
  })
}

export function addIngredients(
  items: ShoppingItem[],
  ingredients: Ingredient[],
  multiplier = 1,
): ShoppingItem[] {
  return ingredients.reduce((result, ingredient) => {
    const product = catalog.find((p) => p.id === ingredient.productId)
    return product
      ? mergeItem(
          result,
          product,
          ingredient.quantity * multiplier,
          ingredient.unit,
          ingredient.note,
          true,
        )
      : result
  }, items)
}

export function addRecipes(
  items: ShoppingItem[],
  recipes: Recipe[],
): ShoppingItem[] {
  return recipes.reduce(
    (result, recipe) => addIngredients(result, recipe.ingredients),
    items,
  )
}

export function restockSuggestions(
  state: AppState,
  now = Date.now(),
): Product[] {
  return [...catalog, ...state.customProducts].filter((product) => {
    const last = state.purchases[product.id]
    return (
      product.interval &&
      last &&
      now - new Date(last).getTime() >= product.interval * 86400000 &&
      !state.items.some((item) => item.id === product.id && !item.checked)
    )
  })
}

export function mondayOfWeek(date = new Date(), offset = 0): Date {
  const result = new Date(date)
  result.setHours(12, 0, 0, 0)
  result.setDate(result.getDate() - ((result.getDay() + 6) % 7) + offset * 7)
  return result
}
export function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
