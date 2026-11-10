import type { AppState, Recipe } from './data'
import { getProducts } from './catalog'
import { recipeScore } from './learning'
import { dateKey, householdDate } from './shopping'
import { isLeftover } from './recipe-options'
export type RecipeSort =
  'favorites' | 'popular' | 'recommended' | 'name' | 'quick'
export function mealType(
  recipe: Recipe,
  state: AppState,
): 'fish' | 'vegetarian' | 'poultry' | 'meat' {
  if (recipe.mealType) return recipe.mealType
  const products = getProducts(state)
  const protein = recipe.ingredients
    .map((i) => products.find((p) => p.id === i.productId))
    .filter(Boolean)
  if (
    protein.some(
      (p) =>
        p?.category === 'Fish' || /salmon|fish|lohi|kala/.test(p?.id ?? ''),
    )
  )
    return 'fish'
  if (protein.some((p) => /chicken|turkey|broileri|quail/.test(p?.id ?? '')))
    return 'poultry'
  if (protein.some((p) => p?.category === 'Meat')) return 'meat'
  return 'vegetarian'
}
export function plusDay(day: string, delta: number) {
  const date = new Date(day + 'T12:00:00Z')
  date.setUTCDate(date.getUTCDate() + delta)
  return date.toISOString().slice(0, 10)
}
function weekStart(day: string) {
  const weekday = new Date(day + 'T12:00:00Z').getUTCDay()
  return plusDay(day, -((weekday + 6) % 7))
}
export function rankForDay(
  recipes: Recipe[],
  state: AppState,
  day: string,
  rotation = 0,
) {
  const start = weekStart(day),
    end = plusDay(start, 7)
  const planned = Object.entries(state.plan)
    .filter(([d]) => d >= start && d < end && d !== day)
    .flatMap(([, id]) => recipes.find((r) => r.id === id) ?? [])
  const counts = { fish: 0, vegetarian: 0, poultry: 0, meat: 0 }
  for (const recipe of planned) counts[mealType(recipe, state)]++
  const targets = { fish: 2, vegetarian: 2, poultry: 1, meat: 1 }
  return recipes
    .map((recipe, index) => {
      const base = recipeScore(recipe, state)
      const type = mealType(recipe, state)
      const score =
        base.score +
        (base.score <= -999
          ? 0
          : (counts[type] < targets[type]
              ? 8
              : -4 * (counts[type] - targets[type] + 1)) -
            planned.filter((r) => r.id === recipe.id).length * 30 -
            planned.filter(
              (r) =>
                r.id !== recipe.id &&
                r.variantGroup &&
                r.variantGroup === recipe.variantGroup,
            ).length *
              12 +
            (recipe.kidApproved ? 2 : 0) +
            Math.min(
              3,
              Math.log2(
                1 +
                  (state.recipeUsage?.[recipe.id]?.planned ?? 0) +
                  (state.recipeUsage?.[recipe.id]?.shopping ?? 0),
              ),
            ))
      const reasons = [
        ...(counts[type] < targets[type]
          ? [
              `Adds ${type === 'poultry' ? 'chicken' : type} variety to this week`,
            ]
          : []),
        ...(recipe.kidApproved ? ['Kid-approved'] : []),
        ...base.reasons,
      ]
      return {
        recipe,
        score,
        reasons,
        tie: (index + rotation) % Math.max(recipes.length, 1),
      }
    })
    .filter((entry) => recipeScore(entry.recipe, state).score > -999)
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.tie - b.tie ||
        a.recipe.name.localeCompare(b.recipe.name),
    )
}
export function sortRecipes(
  recipes: Recipe[],
  state: AppState,
  sort: RecipeSort,
): Recipe[] {
  const now = dateKey(householdDate(state.preferences?.timeZone))
  const scores = new Map(
    rankForDay(recipes, state, now).map((r) => [r.recipe.id, r.score]),
  )
  const uses = (id: string) =>
    (state.recipeUsage?.[id]?.planned ?? 0) +
    (state.recipeUsage?.[id]?.shopping ?? 0)
  return [...recipes].sort((a, b) => {
    if (sort === 'recommended')
      return (
        (scores.get(b.id) ?? -1000) - (scores.get(a.id) ?? -1000) ||
        a.name.localeCompare(b.name)
      )
    if (sort === 'name') return a.name.localeCompare(b.name)
    if (sort === 'quick')
      return a.minutes - b.minutes || a.name.localeCompare(b.name)
    if (sort === 'favorites') {
      const favorites =
        Number(state.favoriteRecipeIds.includes(b.id)) -
        Number(state.favoriteRecipeIds.includes(a.id))
      if (favorites) return favorites
    }
    return uses(b.id) - uses(a.id) || a.name.localeCompare(b.name)
  })
}
export type LunchSuggestion = {
  recipe: Recipe
  reasons: string[]
  servings: number
  leftoverFrom?: string
  existing?: boolean
}
/** Fill only future open days, progressively scoring the week including saved meals. */
export function balancedWeek(
  recipes: Recipe[],
  state: AppState,
  days: string[],
  rotation = 0,
): Array<LunchSuggestion | null> {
  const working = {
    ...state,
    plan: { ...state.plan },
    servings: { ...state.servings },
    planOptions: { ...state.planOptions },
  }
  const today = dateKey(householdDate(state.preferences?.timeZone)),
    portions = state.preferences?.servings ?? 4
  let leftoverUsed = false
  return days
    .map((day, index) => {
      const existing = recipes.find((r) => r.id === working.plan[day])
      if (existing)
        return {
          recipe: existing,
          reasons: ['Keep your saved lunch'],
          servings: working.servings[day] ?? portions,
          existing: true,
        }
      if (day < today) return null
      const previousDay = plusDay(day, -1),
        previous = recipes.find((r) => r.id === working.plan[previousDay])
      const existingBatch =
        !!previous &&
        !!state.plan[previousDay] &&
        (state.servings?.[previousDay] ?? portions) >= portions * 2 &&
        state.mealFeedback?.[previousDay]?.status !== 'skipped'
      const previousSuggestion =
        index > 0 ? days[index - 1] === previousDay : false
      // Offer a deliberate new batch, or a saved plan that already prepares extra portions.
      if (
        !leftoverUsed &&
        ((previousSuggestion && !state.plan[previousDay]) || existingBatch) &&
        previous?.makesLeftovers &&
        portions * 2 <= 100 &&
        !isLeftover(working, previousDay, previous) &&
        recipeScore(previous, state).score > -999
      ) {
        leftoverUsed = true
        working.plan[day] = previous.id
        working.servings[previousDay] = Math.max(
          previous.servings,
          portions * 2,
        )
        working.servings[day] = portions
        working.planOptions[day] = {
          recipeId: previous.id,
          choices: {},
          leftoverFrom: previousDay,
        }
        return {
          recipe: previous,
          reasons: [
            'Possible leftovers from the previous extra batch — use only if saved and refrigerated promptly',
          ],
          servings: portions,
          leftoverFrom: previousDay,
        }
      }
      const ranked = rankForDay(recipes, working, day, rotation)
      if (!ranked.length) return null
      const alternatives = ranked
        .filter(
          (entry) =>
            mealType(entry.recipe, state) ===
              mealType(ranked[0].recipe, state) &&
            entry.score >= ranked[0].score - 8,
        )
        .slice(0, 3)
      const chosen = alternatives[rotation % alternatives.length]
      working.plan[day] = chosen.recipe.id
      working.servings[day] = portions
      return {
        recipe: chosen.recipe,
        reasons: chosen.reasons,
        servings: portions,
      }
    })
    .map((suggestion, index, values) =>
      suggestion &&
      !suggestion.existing &&
      values[index + 1]?.leftoverFrom === days[index]
        ? {
            ...suggestion,
            servings: Math.max(suggestion.recipe.servings, portions * 2),
            reasons: [
              'Cook an extra batch for tomorrow',
              ...suggestion.reasons,
            ],
          }
        : suggestion,
    )
}
