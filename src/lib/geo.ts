import type { GeoPoint } from './api/GeoPoint'
import type { Store } from './data'

/** Default for how close a shop must be (plus GPS uncertainty, capped) to count as "here". */
export const nearbyMeters = 1000

export function distanceMeters(a: GeoPoint, b: GeoPoint) {
  const radians = Math.PI / 180
  const dLat = (b.lat - a.lat) * radians
  const dLng = (b.lng - a.lng) * radians
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * radians) *
      Math.cos(b.lat * radians) *
      Math.sin(dLng / 2) ** 2
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)))
}

export function nearestStore(
  stores: Store[],
  here: GeoPoint,
  accuracy = 0,
  nearby = nearbyMeters,
): Store | undefined {
  const reach = nearby + Math.min(Math.max(accuracy, 0), nearby)
  let best: { store: Store; distance: number } | undefined
  for (const store of stores) {
    if (!store.position) continue
    const distance = distanceMeters(here, store.position)
    if (distance <= reach && (!best || distance < best.distance))
      best = { store, distance }
  }
  return best?.store
}

/** Accepts "60.1699, 24.9384" as copied from most map apps. */
export function parsePoint(text: string): GeoPoint | undefined | null {
  if (!text.trim()) return undefined
  const match = text
    .trim()
    .match(/^(-?\d{1,2}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)$/)
  if (!match) return null
  const lat = Number(match[1]),
    lng = Number(match[2])
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null
  return { lat, lng }
}

export function formatPoint(point?: GeoPoint) {
  return point ? `${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}` : ''
}

export function currentPosition(timeout = 10000) {
  return new Promise<GeolocationPosition>((resolve, reject) => {
    if (!('geolocation' in navigator))
      reject(new Error('Location is not available in this browser.'))
    else
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        maximumAge: 60000,
        timeout,
      })
  })
}
