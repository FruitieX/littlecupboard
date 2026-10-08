import type { AppState, Amount } from './data'
import type { StockEstimate } from './api/StockEstimate'

/** Which warning a cupboard estimate shows, if any. */
export function stockWarning(
  estimate: StockEstimate | undefined,
): 'use-soon' | 'restock' | null {
  const status = estimate?.status ?? ''
  if (status === 'expiring' || status === 'expired') return 'use-soon'
  if (status === 'low' || status === 'out') return 'restock'
  return null
}

/**
 * A dismissed warning stays hidden until the next purchase or confirmed
 * amount. "Running low" shares its dismissal with the shopping suggestion.
 */
export function warningDismissed(
  state: AppState,
  id: string,
  warning: 'use-soon' | 'restock',
) {
  const feedback = state.suggestionFeedback?.[`${warning}:${id}`]
  if (feedback?.status !== 'dismissed') return false
  const entry = state.pantry?.[id]
  const purchased = state.purchases[id] ?? ''
  const confirmed = entry?.confirmed ? entry.observedAt : ''
  return feedback.at > purchased && feedback.at > confirmed
}

export function dismissWarning(
  state: AppState,
  id: string,
  warning: 'use-soon' | 'restock',
): AppState {
  return {
    ...state,
    suggestionFeedback: {
      ...state.suggestionFeedback,
      [`${warning}:${id}`]: {
        status: 'dismissed',
        at: new Date().toISOString(),
        until: null,
      },
    },
  }
}

function mergeAmounts(a: Amount[], b: Amount[]) {
  const merged: Amount[] = []
  for (const amount of [...a, ...b]) {
    const same = merged.find((entry) => entry.unit === amount.unit)
    if (same) same.quantity += amount.quantity
    else merged.push({ ...amount })
  }
  return merged.filter((amount) => amount.quantity > 0)
}

/**
 * Moves what we have from one item to another, for example when a photo was
 * recognized as the wrong thing. Amounts add up if both are recorded.
 */
export function movePantryEntry(
  state: AppState,
  from: string,
  to: string,
): AppState {
  const source = state.pantry?.[from]
  if (!source || from === to) return state
  const target = state.pantry?.[to]
  const pantry = { ...state.pantry }
  delete pantry[from]
  const expiries = [source.expiresAt, target?.expiresAt].filter(
    (value): value is string => !!value,
  )
  pantry[to] = {
    amounts: mergeAmounts(target?.amounts ?? [], source.amounts),
    confirmed: target ? false : source.confirmed,
    observedAt: new Date().toISOString(),
    expiresAt: expiries.sort()[0] ?? null,
    note: target?.note || source.note,
  }
  const aiAdded = { ...state.aiAdded }
  delete aiAdded[from]
  return { ...state, pantry, aiAdded }
}
