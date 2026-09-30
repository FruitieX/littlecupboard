import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react'
import type { Dispatch, ReactNode, SetStateAction } from 'react'
import { initialState, recipes } from './data'
import type { AppState } from './data'

const STORAGE_KEY = 'family-shopping-prototype-v1'
const Context = createContext<{
  state: AppState
  setState: Dispatch<SetStateAction<AppState>>
  ready: boolean
} | null>(null)
function parseState(value: string | null): AppState | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as AppState
    if (
      Array.isArray(parsed.items) &&
      Array.isArray(parsed.stores) &&
      parsed.stores.length &&
      parsed.plan &&
      parsed.purchases &&
      Array.isArray(parsed.customProducts)
    )
      return {
        ...parsed,
        customRecipes: parsed.customRecipes ?? [],
        favoriteRecipeIds: parsed.favoriteRecipeIds ?? [
          'green-pasta',
          'salmon-bowl',
        ],
      }
  } catch {
    /* Start with the demo when storage is unavailable or corrupt. */
  }
  return null
}
export function AppProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState(initialState)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    try {
      const saved = parseState(localStorage.getItem(STORAGE_KEY))
      if (saved) setState(saved)
    } catch {
      /* Private browser mode. */
    }
    setReady(true)
    const update = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY) return
      const saved = parseState(event.newValue)
      if (saved) setState(saved)
    }
    window.addEventListener('storage', update)
    return () => window.removeEventListener('storage', update)
  }, [])
  useEffect(() => {
    if (ready) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
      } catch {
        /* Continue in memory. */
      }
    }
  }, [state, ready])
  return (
    <Context.Provider value={{ state, setState, ready }}>
      <div data-app-ready={ready} inert={!ready}>
        {children}
      </div>
    </Context.Provider>
  )
}
export function useApp() {
  const context = useContext(Context)
  if (!context) throw new Error('AppProvider is required')
  const update = useCallback(
    (fn: (state: AppState) => AppState) => context.setState(fn),
    [context.setState],
  )
  return {
    ...context,
    update,
    allRecipes: [...recipes, ...context.state.customRecipes],
  }
}
