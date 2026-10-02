import type { Ingredient, Product } from './data'

// Recipe-local replacement: never rename a shared catalog product.
export function replaceRecipeIngredients(
  ingredients: Ingredient[],
  products: Product[],
  names: Record<string, string>,
  groups: Record<string, string>,
) {
  const created: Product[] = []
  const result: Ingredient[] = []
  for (const ingredient of ingredients) {
    const original = products.find((p) => p.id === ingredient.productId)
    const name = (names[ingredient.productId] ?? original?.name ?? '').trim()
    if (!name) throw new Error('Give every ingredient a name.')
    let product = [...products, ...created].find(
      (p) => p.name.toLowerCase() === name.toLowerCase(),
    )
    if (!product) {
      product = {
        id: crypto.randomUUID(),
        name,
        category: groups[ingredient.productId] ?? original!.category,
        icon: '🛒',
        aliases: [],
      }
      created.push(product)
    }
    const match = result.find((i) => i.productId === product.id)
    if (match) {
      if (
        match.unit.trim().toLowerCase() !== ingredient.unit.trim().toLowerCase()
      )
        throw new Error(
          `Use the same unit for repeated ${product.name} ingredients before combining them.`,
        )
      match.quantity += ingredient.quantity
      match.note = [
        ...new Set([match.note, ingredient.note].filter(Boolean)),
      ].join('; ')
    } else result.push({ ...ingredient, productId: product.id })
  }
  return { ingredients: result, created }
}
