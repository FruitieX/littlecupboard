import type { Recipe } from './data'

export function normalizeTags(values: string | string[], known: string[] = []) {
  const canonical = new Map(known.map((tag) => [tag.toLowerCase(), tag]))
  const result = new Map<string, string>()
  for (const raw of typeof values === 'string' ? values.split(',') : values) {
    const tag = raw.trim().replace(/\s+/g, ' ')
    const key = tag.toLowerCase()
    if (tag && !result.has(key)) result.set(key, canonical.get(key) ?? tag)
  }
  return [...result.values()]
}

export function recipeTags(recipe: Pick<Recipe, 'tags' | 'tag'>) {
  return normalizeTags([...(recipe.tags ?? []), recipe.tag])
}

export function availableRecipeTags(recipes: Recipe[]) {
  return normalizeTags(recipes.flatMap(recipeTags)).sort((a, b) =>
    a.localeCompare(b),
  )
}

export function hasRecipeTag(recipe: Recipe, tag: string) {
  return recipeTags(recipe).some(
    (value) => value.toLowerCase() === tag.toLowerCase(),
  )
}
