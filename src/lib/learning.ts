import { getProducts } from './catalog'
import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { ReactNode } from 'react'
import { api } from './http'
import { insightsCacheKey, useApp } from './state'
import { replaceEqualDeep } from './structural'
import type { AppState, Product, Recipe } from './data'
import type { ConsumptionRate } from './api/ConsumptionRate'
import type { HistoryEvent } from './api/HistoryEvent'
import type { HouseholdStats } from './api/HouseholdStats'
import type { StockEstimate } from './api/StockEstimate'
export type Restock = {
  product: Product
  quantity: number
  unit: string
  note: string
  intervalDays: number | null
  daysSince: number
  daysLeft?: number | null
  reason: string
  confidence: string
}
export type Habit = {
  productId: string
  name: string
  purchases: number
  intervalDays: number | null
  estimatedConsumption: ConsumptionRate | null
  consumptionRate: ConsumptionRate | null
  consumptionSource: string
  confidence: string
  preferredNote: string
  quantity: number | null
  unit: string | null
  storeId: string
  lastBought: string
}
export type Insights = {
  restock: Restock[]
  stock: StockEstimate[]
  nextShoppingDay: string | null
  habits: Habit[]
  shoppingDays: Record<string, number>
  associations: { products: string[]; daysTogether: number }[]
  purchaseCount: number
}
const emptyInsights: Insights = {
  restock: [],
  stock: [],
  nextShoppingDay: null,
  habits: [],
  shoppingDays: {},
  associations: [],
  purchaseCount: 0,
}
type LearningValue = { insights: Insights; error: string; loaded: boolean }
const LearningContext = createContext<LearningValue>({
  insights: emptyInsights,
  error: '',
  loaded: false,
})

// Refetch derived server data once the household has been quiet for a moment.
// Checking several items in a row then costs one request after the last tap,
// instead of competing with every tile animation.
function useQuietFetch<T>(
  path: string | null,
  initial: T,
  delay = 1200,
  cacheKey?: string,
): { data: T; error: string; loaded: boolean } {
  const { state, status } = useApp()
  // A cached response renders on the first frame after launch, so derived
  // sections such as Running low do not pop in once the request returns.
  const [data, setData] = useState<T>(() => {
    if (!cacheKey) return initial
    try {
      const cached = localStorage.getItem(cacheKey)
      return cached ? (JSON.parse(cached) as T) : initial
    } catch {
      return initial
    }
  })
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(false)
  const first = useRef(true)
  useEffect(() => {
    first.current = true
    setLoaded(false)
  }, [path])
  useEffect(() => {
    if (!path || status === 'offline') return
    let active = true
    const timer = setTimeout(
      () => {
        first.current = false
        api<T>(path)
          .then((next) => {
            if (!active) return
            setData((previous) => replaceEqualDeep(previous, next))
            if (cacheKey)
              try {
                localStorage.setItem(cacheKey, JSON.stringify(next))
              } catch {
                // Without storage the section simply waits for the request.
              }
            setError('')
            setLoaded(true)
          })
          .catch((error: Error) => {
            if (active) setError(error.message)
          })
      },
      first.current ? 0 : delay,
    )
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [path, state, status, delay, cacheKey])
  return { data, error, loaded }
}

export function LearningProvider({ children }: { children: ReactNode }) {
  const { session } = useApp()
  const { data, error, loaded } = useQuietFetch(
    '/insights',
    emptyInsights,
    1200,
    insightsCacheKey(session),
  )
  const value = useMemo(
    () => ({ insights: { ...emptyInsights, ...data }, error, loaded }),
    [data, error, loaded],
  )
  return createElement(LearningContext.Provider, { value }, children)
}
export function useLearning() {
  return useContext(LearningContext)
}
export function useHistory(enabled = true) {
  const { data, error, loaded } = useQuietFetch<HistoryEvent[]>(
    enabled ? '/history?limit=100' : null,
    [],
  )
  return { history: data, error, loaded }
}
export function useStats(enabled = true) {
  return useQuietFetch<HouseholdStats | null>(
    enabled ? '/stats' : null,
    null,
    2000,
  )
}
export function recipeScore(
  recipe: Recipe,
  state: AppState,
  now = Date.now(),
): { score: number; reasons: string[] } {
  if (recipe.mealPlanEligible === false)
    return { score: -1000, reasons: ['Excluded from meal planning'] }
  let score = 0
  const reasons: string[] = []
  const prefs = state.preferences
  const excluded = prefs?.avoid.some(
    (term) =>
      recipe.name.toLowerCase().includes(term.toLowerCase()) ||
      recipe.ingredients.some((i) =>
        i.productId.includes(term.toLowerCase().replace(/ /g, '-')),
      ),
  )
  if (excluded)
    return { score: -1000, reasons: ['Contains an ingredient you avoid'] }
  const products = recipe.ingredients
    .map((i) => getProducts(state).find((p) => p.id === i.productId))
    .filter((p): p is Product => !!p)
  const dietary = prefs?.dietary.map((d) => d.toLowerCase()) ?? []
  const incompatible =
    (dietary.some((d) => ['vegetarian', 'vegan'].includes(d)) &&
      products.some((p) => ['Meat', 'Fish'].includes(p.category))) ||
    (dietary.includes('vegan') &&
      products.some(
        (p) =>
          ['Cheese', 'Milk & eggs'].includes(p.category) || p.id === 'honey',
      )) ||
    (dietary.includes('gluten-free') &&
      products.some(
        (p) =>
          /pasta|bread|flour|bulgur|couscous|barley|tortilla/i.test(p.name) &&
          !p.name.toLowerCase().includes('gluten-free'),
      ))
  if (incompatible)
    return {
      score: -1000,
      reasons: ['Does not match your dietary preferences'],
    }
  if (state.favoriteRecipeIds.includes(recipe.id)) {
    score += 3
    reasons.push('A family favorite')
  }
  const meals = Object.entries(state.mealFeedback ?? {}).filter(
    ([, f]) => f.recipeId === recipe.id,
  )
  const cooked = meals
    .filter(([, f]) => f.status === 'cooked')
    .sort(([a], [b]) => b.localeCompare(a))
  if (cooked[0]) {
    const ago = Math.floor((now - new Date(cooked[0][0]).getTime()) / 86400000)
    score += Math.min(ago / 7, 4) - (ago < 7 ? 6 : 0)
    reasons.push(ago < 7 ? 'Cooked recently' : `Last cooked ${ago} days ago`)
  } else {
    score += (prefs?.novelty ?? 0.25) * 4
    reasons.push('Something to try from your recipe book')
  }
  const rating = cooked
    .map(([, f]) => f.rating)
    .filter((r): r is number => r !== null)
  if (rating.length) {
    score += rating.reduce((a, b) => a + b, 0) / rating.length - 3
    reasons.push(
      `Family rating ${(rating.reduce((a, b) => a + b, 0) / rating.length).toFixed(1)}/5`,
    )
  }
  score -= meals.filter(([, f]) => f.status === 'skipped').length
  const shared = recipe.ingredients.filter(
    (i) =>
      state.items.some((item) => item.id === i.productId && !item.checked) ||
      state.pantry?.[i.productId]?.amounts.length,
  ).length
  if (shared) {
    score += (shared / recipe.ingredients.length) * 5
    reasons.push(`${shared} ingredients already listed or likely available`)
  }
  if (recipe.minutes <= (prefs?.maxWeekdayMinutes ?? 30)) {
    score += 2
    reasons.push(
      `Fits your ${prefs?.maxWeekdayMinutes ?? 30}-minute weekday limit`,
    )
  }
  return { score, reasons }
}
export function suggestWeek(
  recipes: Recipe[],
  state: AppState,
  rotation = 0,
): Recipe[] {
  const ranked = recipes
    .filter((r) => recipeScore(r, state).score > -999)
    .sort((a, b) => recipeScore(b, state).score - recipeScore(a, state).score)
  if (!ranked.length) return []
  return Array.from(
    { length: 7 },
    (_, i) => ranked[(i + rotation) % ranked.length],
  )
}
export function discovery(recipes: Recipe[], state: AppState): Recipe | null {
  const base = [...recipes]
    .filter((r) => recipeScore(r, state).score > -999)
    .sort(
      (a, b) => recipeScore(b, state).score - recipeScore(a, state).score,
    )[0]
  if (!base) return null
  const choices = [
    { id: 'chickpeas', name: 'chickpea', unit: 'g', quantity: 240 },
    { id: 'spinach', name: 'spinach', unit: 'g', quantity: 150 },
    { id: 'lemon', name: 'lemon', unit: 'pc', quantity: 1 },
  ]
  const extra = choices.find(
    (p) =>
      !base.ingredients.some((i) => i.productId === p.id) &&
      !state.preferences?.avoid.some((a) => p.id.includes(a.toLowerCase())),
  )
  if (!extra) return null
  const id = `discovery-${base.id}-${extra.id}`
  if (
    recipes.some((r) => r.id === id) ||
    state.suggestionFeedback?.[id]?.status === 'dismissed'
  )
    return null
  return {
    ...base,
    id,
    name: `${base.name} with ${extra.name}`,
    subtitle: `A small variation on ${base.name}. Taste and adjust the addition for your family.`,
    image: '/images/recipe-placeholder.svg',
    tag: 'New variation',
    tags: [...(base.tags ?? []), 'Variation'],
    ingredients: [
      ...base.ingredients,
      { productId: extra.id, quantity: extra.quantity, unit: extra.unit },
    ],
    steps: [
      ...base.steps,
      `Add the ${extra.name} to taste: rinse and warm chickpeas, wilt spinach, or finish with lemon juice, as appropriate. Taste before serving.`,
    ],
  }
}
