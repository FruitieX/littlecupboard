import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { initialState, catalog } from './data'
import {
  archiveProduct,
  deleteProduct,
  deleteRecipe,
  getProducts,
  saveProduct,
} from './catalog'
import { diffState, optimistic } from './sync'
import { changeGroup } from './groups'

it('ships artwork for every distinct built-in catalog icon', () => {
  for (const product of catalog) {
    expect(
      product.image,
      `${product.name} has explicit reviewed artwork`,
    ).toMatch(/^\/images\/(food|catalog\/generated)\//)
    const file = readFileSync(
      new URL(`../../public${product.image}`, import.meta.url),
    )
    expect(file.length).toBeGreaterThan(100)
    if (product.image!.endsWith('.webp')) {
      expect(file.toString('ascii', 0, 4)).toBe('RIFF')
      expect(file.toString('ascii', 8, 12)).toBe('WEBP')
    } else expect(file.toString()).toContain('<svg')
  }
  for (const icon of new Set(catalog.map((product) => product.icon))) {
    const code = [...icon]
      .map((character) => character.codePointAt(0)!.toString(16))
      .filter((part) => part !== 'fe0f')
      .join('-')
    const svg = readFileSync(
      new URL(`../../public/images/food/${code}.svg`, import.meta.url),
      'utf8',
    )
    expect(svg).toContain('<svg')
  }
})

describe('settings catalog management', () => {
  it('gives known custom aliases artwork without replacing chosen icons or photos', () => {
    const state = initialState()
    state.customProducts = [
      'Water',
      'Basil',
      'Grated Emmental–mozzarella cheese',
    ].map((name, i) => ({
      id: `family-${i}`,
      name,
      icon: '🛒',
      category: 'Ingredients',
    }))
    const custom = getProducts(state).filter((product) =>
      product.id.startsWith('family-'),
    )
    expect(custom.map((product) => product.image)).toEqual([
      '/images/catalog/generated/water.webp',
      '/images/catalog/generated/basil.webp',
      '/images/catalog/generated/grated-cheese.webp',
    ])
    // Household updates always produce new snapshots.
    const chosenIcon = {
      ...state,
      customProducts: state.customProducts.map((product, index) =>
        index === 0 ? { ...product, icon: '🥛' } : product,
      ),
    }
    expect(
      getProducts(chosenIcon).find((product) => product.id === 'family-0')
        ?.image,
    ).toBeUndefined()
    const photo = {
      ...chosenIcon,
      productImages: { 'family-1': '/api/images/family-basil' },
    }
    expect(
      getProducts(photo).find((product) => product.id === 'family-1')?.image,
    ).toBe('/api/images/family-basil')
  })
  it('fills artwork for old item customizations while retaining family photos', () => {
    const state = initialState()
    const rice = catalog.find((product) => product.id === 'rice')!
    state.productDetails = {
      rice: { ...rice, name: 'Family rice', image: undefined },
    }
    expect(
      getProducts(state).find((product) => product.id === 'rice')?.image,
    ).toBe(rice.image)
    const familyPhoto = {
      ...state,
      productDetails: {
        rice: {
          ...state.productDetails.rice,
          image: '/api/images/family-rice',
        },
      },
    }
    expect(
      getProducts(familyPhoto).find((product) => product.id === 'rice')?.image,
    ).toBe('/api/images/family-rice')
    const newPhoto = {
      ...familyPhoto,
      productImages: { rice: '/api/images/new-rice' },
    }
    expect(
      getProducts(newPhoto).find((product) => product.id === 'rice')?.image,
    ).toBe('/api/images/new-rice')
  })
  it('keeps product identity and shopping details while overriding a bundled product', () => {
    const state = initialState()
    const apple = catalog.find((product) => product.id === 'apples')!
    state.items = [
      { ...apple, quantity: 4, unit: 'pc', note: 'Pink lady', checked: true },
    ]
    const changed = saveProduct(state, {
      ...apple,
      name: 'Eating apples',
      category: state.stores[0].order[1],
      aliases: ['sweet apples'],
      image: '/api/images/test-image',
    })
    expect(
      getProducts(changed).find((product) => product.id === 'apples'),
    ).toMatchObject({ name: 'Eating apples', aliases: ['sweet apples'] })
    expect(changed.items[0]).toMatchObject({
      name: 'Eating apples',
      checked: true,
      quantity: 4,
      note: 'Pink lady',
    })
    expect(
      diffState(state, changed).some(
        (change) => change.collection === 'productDetails',
      ),
    ).toBe(true)
    expect(
      optimistic(changed, {
        type: 'addItem',
        productId: 'apples',
        quantity: 1,
        unit: 'pc',
        note: '',
        accumulate: false,
      }).items[0].name,
    ).toBe('Eating apples')
    const migrated = changeGroup(
      changed,
      changed.items[0].category,
      'Fresh produce',
    )
    expect(migrated.productDetails?.apples.category).toBe('Fresh produce')
  })
  it('archives suggestions without breaking recipe identity and restores the customization', () => {
    const state = initialState()
    const apple = catalog.find((product) => product.id === 'apples')!
    const changed = archiveProduct(
      saveProduct(state, { ...apple, name: 'Eating apples' }),
      apple.id,
      true,
    )
    expect(
      getProducts(changed, false).some((product) => product.id === apple.id),
    ).toBe(false)
    expect(
      getProducts(changed).find((product) => product.id === apple.id)?.name,
    ).toBe('Eating apples')
    expect(
      getProducts(archiveProduct(changed, apple.id, false), false).find(
        (product) => product.id === apple.id,
      )?.name,
    ).toBe('Eating apples')
    expect(() => deleteProduct(changed, apple.id)).toThrow('Built-in')
  })
  it('rejects deleting referenced custom ingredients and cleans all live references after deletion', () => {
    const state = initialState()
    const custom = {
      id: 'family-item',
      name: 'Family item',
      category: state.stores[0].order[0],
      icon: '🛒',
      aliases: [],
    }
    const changed = saveProduct(state, custom)
    changed.customRecipes = [
      {
        id: 'family-recipe',
        name: 'Family recipe',
        subtitle: '',
        image: '/images/pasta.jpg',
        minutes: 10,
        servings: 4,
        tag: 'Family',
        steps: ['Cook'],
        ingredients: [{ productId: custom.id, quantity: 1, unit: 'pc' }],
      },
    ]
    changed.items = [
      { ...custom, quantity: 1, unit: 'pc', note: '', checked: false },
    ]
    changed.pantry = {
      [custom.id]: {
        amounts: [{ quantity: 1, unit: 'pc' }],
        confirmed: true,
        observedAt: new Date().toISOString(),
        expiresAt: null,
        note: '',
      },
    }
    expect(() => deleteProduct(changed, custom.id)).toThrow('used in a recipe')
    const removed = deleteProduct(
      deleteRecipe(changed, 'family-recipe'),
      custom.id,
    )
    expect(removed.customProducts).toHaveLength(0)
    expect(removed.items).toHaveLength(0)
    expect(removed.pantry).toEqual({})
    expect(removed.productGroups?.[custom.id]).toBeUndefined()
  })
})

it('syncs per-product consumption rates and deletes them with a custom item', () => {
  let state = initialState()
  const product = {
    id: 'test-rate',
    name: 'Rate test',
    category: state.stores[0].order[0],
    icon: '🛒',
    aliases: [],
  }
  state = saveProduct(state, product)
  const changed = {
    ...state,
    consumptionRates: { [product.id]: { quantity: 4, unit: 'L', days: 7 } },
  }
  const changes = diffState(state, changed)
  expect(changes).toEqual([
    {
      collection: 'consumptionRates',
      key: product.id,
      field: null,
      before: null,
      after: { quantity: 4, unit: 'L', days: 7 },
    },
  ])
  const replayed = optimistic(state, {
    type: 'patch',
    changes,
    label: 'Set rate',
  })
  expect(replayed.consumptionRates).toEqual(changed.consumptionRates)
  expect(deleteProduct(replayed, product.id).consumptionRates).toEqual({})
})

describe('getProducts cache', () => {
  it('reuses the merged catalog for an unchanged snapshot only', () => {
    const state = initialState()
    expect(getProducts(state)).toBe(getProducts(state))
    expect(getProducts(state, false)).not.toBe(getProducts(state))
    const archived = { ...state, archivedProductIds: ['rice'] }
    expect(getProducts(archived, false).some((p) => p.id === 'rice')).toBe(
      false,
    )
    expect(getProducts(state, false).some((p) => p.id === 'rice')).toBe(true)
  })
})

it('hides one-off items from the catalog and forgets them after the trip', () => {
  let state = initialState()
  const blanket = {
    id: 'one-off-blanket',
    name: 'Blanket 115 × 150 cm',
    category: state.stores[0].order[0],
    icon: '🛒',
    aliases: [],
    oneOff: true,
  }
  state = { ...state, customProducts: [blanket] }
  expect(getProducts(state, false).some((p) => p.id === blanket.id)).toBe(false)
  state = optimistic(state, {
    type: 'addItem',
    productId: blanket.id,
    quantity: 1,
    unit: 'pc',
    note: '',
    accumulate: false,
  })
  state = optimistic(state, {
    type: 'checkItem',
    id: blanket.id,
    checked: true,
  })
  expect(state.items.find((item) => item.id === blanket.id)?.checked).toBe(true)
  expect(state.purchases[blanket.id]).toBeUndefined()
  state = optimistic(state, { type: 'finishTrip' })
  expect(state.items.some((item) => item.id === blanket.id)).toBe(false)
  expect(state.customProducts).toHaveLength(0)
})
