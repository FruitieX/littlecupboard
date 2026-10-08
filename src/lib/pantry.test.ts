import { describe, expect, it } from 'vitest'
import type { AppState } from './data'
import { dismissWarning, movePantryEntry, warningDismissed } from './pantry'

const base = {
  items: [],
  stores: [],
  storeId: '',
  plan: {},
  purchases: { milk: '2026-10-01T08:00:00Z' },
  customProducts: [],
  customRecipes: [],
  favoriteRecipeIds: [],
  pantry: {
    milk: {
      amounts: [{ quantity: 1, unit: 'L' }],
      confirmed: false,
      observedAt: '2026-10-01T08:00:00Z',
      expiresAt: '2026-10-09',
      note: '',
    },
    oat: {
      amounts: [
        { quantity: 0.5, unit: 'L' },
        { quantity: 2, unit: 'pc' },
      ],
      confirmed: true,
      observedAt: '2026-10-02T08:00:00Z',
      expiresAt: '2026-10-05',
      note: 'Opened',
    },
  },
  aiAdded: { oat: 'pantry' },
} as AppState

describe('movePantryEntry', () => {
  it('adds amounts to the target and keeps the earliest use-by', () => {
    const moved = movePantryEntry(base, 'oat', 'milk')
    expect(moved.pantry?.oat).toBeUndefined()
    expect(moved.aiAdded?.oat).toBeUndefined()
    expect(moved.pantry?.milk).toMatchObject({
      amounts: [
        { quantity: 1.5, unit: 'L' },
        { quantity: 2, unit: 'pc' },
      ],
      confirmed: false,
      expiresAt: '2026-10-05',
      note: 'Opened',
    })
  })
  it('moves to an item with nothing recorded as is', () => {
    const moved = movePantryEntry(base, 'oat', 'cream')
    expect(moved.pantry?.cream).toMatchObject({
      amounts: base.pantry!.oat.amounts,
      confirmed: true,
    })
  })
})

describe('warningDismissed', () => {
  it('lasts until the next purchase', () => {
    const dismissed = dismissWarning(base, 'milk', 'restock')
    expect(warningDismissed(dismissed, 'milk', 'restock')).toBe(true)
    expect(warningDismissed(dismissed, 'milk', 'use-soon')).toBe(false)
    const bought = {
      ...dismissed,
      purchases: { milk: '2999-01-01T00:00:00Z' },
    }
    expect(warningDismissed(bought, 'milk', 'restock')).toBe(false)
  })
})
