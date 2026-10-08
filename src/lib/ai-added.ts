import type { AppState } from './data'

/** Removes the "added by AI" marker once a family member has checked an item. */
export function approveAiAdded(state: AppState, id: string): AppState {
  if (!state.aiAdded?.[id]) return state
  const aiAdded = { ...state.aiAdded }
  delete aiAdded[id]
  return { ...state, aiAdded }
}
