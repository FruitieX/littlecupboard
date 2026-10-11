import { useEffect, useRef } from 'react'
import { useApp } from '../lib/state'
import { currentPosition, nearestStore } from '../lib/geo'

const resumeAfterMs = 10 * 60 * 1000

/** Selects the shop you are standing in when the app opens or resumes. */
export function NearestShop() {
  const { state, update } = useApp()
  const latest = useRef(state)
  latest.current = state
  const positioned = state.stores.some((store) => store.position)
  useEffect(() => {
    if (!positioned) return
    let disposed = false
    let hiddenAt = 0
    async function locate() {
      const started = latest.current.storeId
      try {
        const permission = await navigator.permissions
          ?.query({ name: 'geolocation' })
          .catch(() => undefined)
        if (permission?.state === 'denied') return
        const { coords } = await currentPosition()
        const now = latest.current
        // A shop picked by hand while we were locating wins.
        if (disposed || now.storeId !== started) return
        const store = nearestStore(
          now.stores,
          { lat: coords.latitude, lng: coords.longitude },
          coords.accuracy,
        )
        if (store && store.id !== now.storeId)
          update((current) => ({ ...current, storeId: store.id }))
      } catch {
        /* Location is a convenience; the last chosen shop stays. */
      }
    }
    function visible() {
      if (document.visibilityState === 'hidden') hiddenAt = Date.now()
      else if (hiddenAt && Date.now() - hiddenAt > resumeAfterMs) void locate()
    }
    void locate()
    document.addEventListener('visibilitychange', visible)
    return () => {
      disposed = true
      document.removeEventListener('visibilitychange', visible)
    }
  }, [positioned])
  return null
}
