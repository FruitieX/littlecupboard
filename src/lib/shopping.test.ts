import { describe, expect, it } from 'vitest'
import { catalog, initialState, recipes } from './data'
import {
  addIngredients,
  dateKey,
  mergeItem,
  mondayOfWeek,
  rankProducts,
  splitVariants,
} from './shopping'

describe('shopping behavior', () => {
  it('merges matching ingredients and preserves quantities and descriptions', () => {
    const pasta = catalog.find((p) => p.id === 'pasta')!
    const items = mergeItem([], pasta, 200, 'g', 'Whole wheat')
    const result = addIngredients(items, recipes[0].ingredients)
    expect(result.filter((p) => p.id === 'pasta')).toHaveLength(1)
    expect(result.find((p) => p.id === 'pasta')).toMatchObject({
      quantity: 600,
      unit: 'g',
      note: 'Whole wheat',
    })
  })
  it('does not add incompatible units together', () => {
    const product = catalog.find((p) => p.id === 'pasta')!
    const result = mergeItem(
      mergeItem([], product, 1, 'pack'),
      product,
      400,
      'g',
      '',
      true,
    )
    expect(result[0]).toMatchObject({
      quantity: 1,
      unit: 'pack',
      note: '',
      amounts: [
        { unit: 'g', quantity: 400 },
        { unit: 'pack', quantity: 1 },
      ],
    })
  })
  it('reactivates checked ingredients with the newly needed quantity', () => {
    const checked = initialState().items.filter((p) => p.id === 'cucumber')
    const result = mergeItem(
      checked,
      catalog.find((p) => p.id === 'cucumber')!,
      2,
      'pc',
    )
    expect(result[0]).toMatchObject({ checked: false, quantity: 2 })
  })
  it('computes current and next weeks across a year boundary', () => {
    const date = new Date(2026, 11, 31, 12)
    expect(dateKey(mondayOfWeek(date))).toBe('2026-12-28')
    expect(dateKey(mondayOfWeek(date, 1))).toBe('2027-01-04')
  })
})

describe('rankProducts', () => {
  const products = [
    { id: 'mango', name: 'Mango', category: 'Fruits', icon: '🥭' },
    { id: 'milk', name: 'Milk', category: 'Milk & eggs', icon: '🥛' },
    { id: 'oat-milk', name: 'Oat milk', category: 'Milk & eggs', icon: '🥛' },
    {
      id: 'mince',
      name: 'Minced meat',
      category: 'Meat',
      icon: '🥩',
      aliases: ['ground beef'],
    },
  ]
  it('prefers name prefixes, then frequently bought products', () => {
    const counts: Record<string, number> = { milk: 12, mango: 1 }
    expect(
      rankProducts(products, 'm', (id) => counts[id] ?? 0).map((p) => p.id),
    ).toEqual(['milk', 'mango', 'mince', 'oat-milk'])
  })
  it('matches aliases after names and ignores empty queries', () => {
    expect(rankProducts(products, 'ground', () => 0).map((p) => p.id)).toEqual([
      'mince',
    ])
    expect(rankProducts(products, '  ', () => 0)).toEqual([])
  })
})

describe('splitVariants', () => {
  const products = [
    { id: 'tea', name: 'Tea', category: 'Beverages', icon: '🍵' },
    {
      id: 'green-tea',
      name: 'Green tea',
      category: 'Beverages',
      icon: '🍵',
    },
    {
      id: 'yogurt',
      name: 'Yogurt',
      category: 'Milk & eggs',
      icon: '🥛',
      aliases: ['jogurtti'],
    },
    { id: 'mango', name: 'Mango', category: 'Fruit & vegetables', icon: '🥭' },
  ]
  it('keeps the extra words as a note for the longest known name', () => {
    expect(splitVariants(products, 'Peppermint tea')).toMatchObject([
      {
        product: { id: 'tea' },
        note: 'Peppermint',
      },
    ])
    expect(splitVariants(products, 'organic green tea')).toMatchObject([
      {
        product: { id: 'green-tea' },
        note: 'organic',
      },
    ])
  })
  it('offers every known item, the first word first', () => {
    expect(splitVariants(products, 'Yogurt Mango')).toMatchObject([
      { product: { id: 'yogurt' }, note: 'Mango' },
      { product: { id: 'mango' }, note: 'Yogurt' },
    ])
    expect(splitVariants(products, 'mango jogurtti')).toMatchObject([
      { product: { id: 'mango' }, note: 'jogurtti' },
      { product: { id: 'yogurt' }, note: 'mango' },
    ])
  })
  it('needs extra words and a known name', () => {
    expect(splitVariants(products, 'tea')).toEqual([])
    expect(splitVariants(products, 'dragon fruit')).toEqual([])
  })
})
