import type { AppState, Ingredient, Recipe } from './data'
export type RecipeOptionGroup =
  import('./api/RecipeOptionGroup').RecipeOptionGroup
export type Choices = Record<string, string>
export function defaultChoices(recipe: Recipe): Choices {
  return Object.fromEntries(
    (recipe.optionGroups ?? []).map((group) => [
      group.id,
      group.optional ? '' : (group.choices[0]?.id ?? ''),
    ]),
  )
}
export function allRecipeIngredients(recipe: Recipe): Ingredient[] {
  return [
    ...recipe.ingredients,
    ...(recipe.optionGroups ?? []).flatMap((group) =>
      group.choices.flatMap((choice) => choice.ingredients),
    ),
  ]
}
export function selectedChoices(
  state: AppState,
  day: string,
  recipe: Recipe,
): Choices {
  const saved = state.planOptions?.[day]
  return saved?.recipeId === recipe.id ? saved.choices : defaultChoices(recipe)
}
export function isLeftover(
  state: AppState,
  day: string,
  recipe: Recipe,
): boolean {
  const options = state.planOptions?.[day]
  return (
    options?.recipeId === recipe.id &&
    !!options.leftoverFrom &&
    options.leftoverFrom < day &&
    state.plan[options.leftoverFrom] === recipe.id &&
    state.mealFeedback?.[options.leftoverFrom]?.status !== 'skipped'
  )
}
export function recipeIngredients(
  recipe: Recipe,
  choices: Choices = defaultChoices(recipe),
): Ingredient[] {
  const values = [...recipe.ingredients]
  for (const group of recipe.optionGroups ?? []) {
    const choice =
      group.choices.find((choice) => choice.id === choices[group.id]) ??
      (!group.optional ? group.choices[0] : undefined)
    if (choice) values.push(...choice.ingredients)
  }
  const merged = new Map<string, Ingredient>()
  for (const value of values) {
    const key = `${value.productId}:${value.unit}`
    const previous = merged.get(key)
    merged.set(
      key,
      previous
        ? {
            ...value,
            quantity: previous.quantity + value.quantity,
            note: [
              ...new Set([previous.note, value.note].filter(Boolean)),
            ].join(' · '),
          }
        : { ...value },
    )
  }
  return [...merged.values()]
}
export function recipeSteps(recipe: Recipe, choices: Choices): string[] {
  const extra = (recipe.optionGroups ?? []).flatMap(
    (group) =>
      (
        group.choices.find((choice) => choice.id === choices[group.id]) ??
        (!group.optional ? group.choices[0] : undefined)
      )?.steps ?? [],
  )
  return extra.length
    ? [...recipe.steps.slice(0, -1), ...extra, ...recipe.steps.slice(-1)]
    : recipe.steps
}
