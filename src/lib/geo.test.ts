import { describe, expect, it } from 'vitest'
import { distanceMeters, nearestStore, parsePoint } from './geo'
import { selectedStore, unknownShopId } from './data'
import type { Store } from './data'

const store = (id: string, lat?: number, lng?: number): Store => ({
  id,
  name: id,
  location: '',
  order: [],
  ...(lat === undefined ? {} : { position: { lat, lng: lng! } }),
})

describe('geo', () => {
  it('measures short distances', () => {
    const d = distanceMeters(
      { lat: 60.17, lng: 24.94 },
      { lat: 60.17, lng: 24.95 },
    )
    expect(d).toBeGreaterThan(540)
    expect(d).toBeLessThan(570)
  })
  it('picks the closest positioned shop within reach', () => {
    const stores = [
      store('none'),
      store('far', 60.2, 24.94),
      store('near', 60.1705, 24.94),
      store('nearer', 60.1702, 24.94),
    ]
    expect(nearestStore(stores, { lat: 60.17, lng: 24.94 })?.id).toBe('nearer')
    expect(nearestStore(stores, { lat: 61, lng: 24.94 })).toBeUndefined()
  })
  it('parses copied coordinates', () => {
    expect(parsePoint('60.1699, 24.9384')).toEqual({
      lat: 60.1699,
      lng: 24.9384,
    })
    expect(parsePoint('-33.86 151.2')).toEqual({ lat: -33.86, lng: 151.2 })
    expect(parsePoint('')).toBeUndefined()
    expect(parsePoint('95, 10')).toBeNull()
    expect(parsePoint('somewhere')).toBeNull()
  })
})

describe('selectedStore', () => {
  const stores = [store('a'), store('b')]
  it('resolves saved shops and falls back to the first', () => {
    expect(selectedStore({ stores, storeId: 'b' }).id).toBe('b')
    expect(selectedStore({ stores, storeId: 'gone' }).id).toBe('a')
  })
  it('offers an unknown shop ordered by household groups', () => {
    const unknown = selectedStore({
      stores,
      storeId: unknownShopId,
      groups: ['Bakery', 'Produce'],
    })
    expect(unknown.name).toBe('Unknown shop')
    expect(unknown.order).toEqual(['Bakery', 'Produce'])
  })
})
