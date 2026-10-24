import type {
  AppState,
  Ingredient,
  Product,
  Recipe,
  ShoppingItem,
} from './data'
import { catalog, listFields } from './data'
import { normalizeSearch } from './search'

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
    return [
      ...items,
      {
        ...listFields(product),
        quantity,
        unit,
        note: note.trim() || product.description || '',
        checked: false,
      },
    ]
  const normalize = (quantity: number, unit: string) => {
    const lower = unit.trim().toLowerCase()
    const normalized = (
      {
        kg: ['g', 1000],
        l: ['ml', 1000],
        litre: ['ml', 1000],
        litres: ['ml', 1000],
        liter: ['ml', 1000],
        liters: ['ml', 1000],
        gram: ['g', 1],
        grams: ['g', 1],
        pcs: ['pc', 1],
        piece: ['pc', 1],
        pieces: ['pc', 1],
        clove: ['cloves', 1],
      } as Record<string, [string, number]>
    )[lower] ?? [lower, 1]
    return { unit: normalized[0], quantity: quantity * normalized[1] }
  }
  return items.map((item) => {
    if (item.id !== product.id) return item
    const added = normalize(quantity, unit),
      previous = normalize(item.quantity, item.unit)
    let extras = item.amounts
    if (accumulate && !item.checked && added.unit !== previous.unit) {
      const values = [
        ...(extras ?? [{ quantity: item.quantity, unit: item.unit }]),
        added,
      ].map((a) => normalize(a.quantity, a.unit))
      extras = Object.entries(
        values.reduce(
          (sum, a) => ({ ...sum, [a.unit]: (sum[a.unit] ?? 0) + a.quantity }),
          {} as Record<string, number>,
        ),
      )
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([unit, quantity]) => ({ unit, quantity }))
    }
    return {
      ...item,
      origin: undefined,
      checked: false,
      quantity: item.checked
        ? quantity
        : accumulate && added.unit === previous.unit
          ? item.quantity + added.quantity / normalize(1, item.unit).quantity
          : item.quantity,
      unit: item.checked ? unit : item.unit,
      note: [...new Set([item.note, note.trim()].filter(Boolean))].join(' · '),
      amounts: item.checked ? undefined : extras,
      planCredits: item.checked ? undefined : item.planCredits,
      manualAmount: item.checked ? undefined : item.manualAmount,
    }
  })
}

export function addIngredients(
  items: ShoppingItem[],
  ingredients: Ingredient[],
  multiplier = 1,
  customProducts: Product[] = [],
  products: Product[] = [...catalog, ...customProducts],
): ShoppingItem[] {
  return ingredients.reduce((result, ingredient) => {
    const product = products.find((p) => p.id === ingredient.productId)
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

export function mondayOfWeek(date = new Date(), offset = 0): Date {
  const result = new Date(date)
  result.setHours(12, 0, 0, 0)
  result.setDate(result.getDate() - ((result.getDay() + 6) % 7) + offset * 7)
  return result
}
export function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function householdDate(timeZone?: string, now = new Date()): Date {
  if (!timeZone) return now
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(now)
  const field = (name: string) =>
    Number(parts.find((part) => part.type === name)?.value)
  return new Date(field('year'), field('month') - 1, field('day'), 12)
}

/**
 * Orders catalog matches by how well the name matches, then by how often the
 * household buys the product, so "m" offers the weekly milk before mango.
 */
export function rankProducts<T extends Product>(
  products: T[],
  query: string,
  purchases: (id: string) => number,
): T[] {
  const needle = normalizeSearch(query.trim())
  if (!needle) return []
  const score = (product: T) => {
    const name = normalizeSearch(product.name)
    if (name === needle) return 0
    if (name.startsWith(needle)) return 1
    if (name.split(/[\s-]+/).some((word) => word.startsWith(needle))) return 2
    if (name.includes(needle)) return 3
    const aliases = (product.aliases ?? []).map(normalizeSearch)
    if (aliases.some((alias) => alias.startsWith(needle))) return 4
    if (aliases.some((alias) => alias.includes(needle))) return 5
    return -1
  }
  return products
    .map((product) => ({ product, rank: score(product) }))
    .filter(({ rank }) => rank >= 0)
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        purchases(b.product.id) - purchases(a.product.id) ||
        a.product.name.localeCompare(b.product.name),
    )
    .map(({ product }) => product)
}

/**
 * "peppermint tea" → Tea with the note "peppermint": finds the longest known
 * item name (or other name) inside a longer query and keeps the rest as the
 * note, so a variety does not need its own item.
 */
export function splitVariants<T extends Product>(
  products: T[],
  query: string,
): { product: T; note: string }[] {
  const words = normalizeSearch(query).split(/\s+/).filter(Boolean)
  const original = query.trim().split(/\s+/).filter(Boolean)
  if (words.length < 2) return []
  // The longest known name per item, e.g. "mango yogurt" finds both Mango
  // and Yogurt; each keeps the other words as its note.
  const found = new Map<string, { product: T; start: number; length: number }>()
  for (const product of products)
    for (const name of [product.name, ...(product.aliases ?? [])]) {
      const parts = normalizeSearch(name).split(/\s+/).filter(Boolean)
      if (!parts.length || parts.length >= words.length) continue
      for (let start = 0; start + parts.length <= words.length; start++) {
        const best = found.get(product.id)
        if (
          parts.every((part, index) => words[start + index] === part) &&
          (!best || parts.length > best.length)
        )
          found.set(product.id, { product, start, length: parts.length })
      }
    }
  const matches = [...found.values()]
  return (
    matches
      // "organic green tea" offers Green tea, not also Tea.
      .filter(
        (m) =>
          !matches.some(
            (other) =>
              other !== m &&
              other.length > m.length &&
              other.start <= m.start &&
              other.start + other.length >= m.start + m.length,
          ),
      )
      // The first word typed usually names the item: "yogurt mango" puts
      // Yogurt (note: mango) first.
      .sort((a, b) => a.start - b.start || b.length - a.length)
      .slice(0, 3)
      .map((m) => ({
        product: m.product,
        note: original
          .filter((_, index) => index < m.start || index >= m.start + m.length)
          .join(' '),
      }))
  )
}
