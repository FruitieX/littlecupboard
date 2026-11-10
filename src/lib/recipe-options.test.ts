import { describe, expect, it } from 'vitest'
import { initialState, recipes } from './data'
import {
  defaultChoices,
  recipeIngredients,
  recipeSteps,
} from './recipe-options'
import { getShoppingItems } from './meal-shopping'
import { balancedWeek, rankForDay, sortRecipes } from './recipe-ranking'
import { discovery } from './learning'
import type { Recipe, AppState } from './data'
const base: Recipe = {
  ...recipes[0],
  id: 'test-options',
  servings: 4,
  ingredients: [{ productId: 'rice', quantity: 250, unit: 'g' }],
  optionGroups: [
    {
      id: 'side',
      name: 'Side',
      optional: false,
      choices: [
        {
          id: 'peas',
          name: 'Peas',
          ingredients: [{ productId: 'frozen-peas', quantity: 200, unit: 'g' }],
          steps: ['Heat peas.'],
        },
        {
          id: 'carrots',
          name: 'Carrots',
          ingredients: [{ productId: 'carrots', quantity: 300, unit: 'g' }],
          steps: ['Steam carrots.'],
        },
      ],
    },
    {
      id: 'dip',
      name: 'Dip',
      optional: true,
      choices: [
        {
          id: 'yogurt',
          name: 'Yoghurt',
          ingredients: [{ productId: 'yogurt', quantity: 150, unit: 'g' }],
          steps: ['Stir dip.'],
        },
      ],
    },
  ],
}
function state(): AppState {
  return {
    ...initialState(),
    items: [],
    plan: {},
    pantry: {},
    recipeBook: [base],
    customRecipes: [],
    preferences: {
      ...initialState().preferences!,
      timeZone: 'UTC',
      servings: 4,
      avoid: [],
      dietary: [],
    },
  }
}
describe('recipe options and ranking', () => {
  it('includes one required side and no optional sauce by default, and merges matching rows', () => {
    expect(defaultChoices(base)).toEqual({ side: 'peas', dip: '' })
    expect(recipeIngredients(base).map((i) => i.productId)).toEqual([
      'rice',
      'frozen-peas',
    ])
    const selected = { side: 'carrots', dip: 'yogurt' }
    expect(recipeIngredients(base, selected).map((i) => i.productId)).toEqual([
      'rice',
      'carrots',
      'yogurt',
    ])
    expect(recipeSteps(base, selected)).toContain('Stir dip.')
  })
  it('scales selected options, preserves shared-list quantities, and does not shop leftovers twice', () => {
    const s = state()
    s.plan = { '2026-11-10': base.id, '2026-11-11': base.id }
    s.servings = { '2026-11-10': 8, '2026-11-11': 4 }
    s.planOptions = {
      '2026-11-10': {
        recipeId: base.id,
        choices: { side: 'carrots', dip: 'yogurt' },
      },
      '2026-11-11': {
        recipeId: base.id,
        choices: {},
        leftoverFrom: '2026-11-10',
      },
    }
    const list = getShoppingItems(s, new Date('2026-11-10T10:00:00Z'))
    expect(list.find((i) => i.id === 'rice')?.quantity).toBe(500)
    expect(list.find((i) => i.id === 'carrots')?.quantity).toBe(600)
    expect(list.find((i) => i.id === 'yogurt')?.quantity).toBe(300)
    expect(list.find((i) => i.id === 'frozen-peas')).toBeUndefined()
  })
  it('orders favorites first, exposes actual use and boosts missing weekly meal types', () => {
    const s = state(),
      fish = { ...base, id: 'fish', name: 'Fish', mealType: 'fish' as const },
      veg = {
        ...base,
        id: 'veg',
        name: 'Veg',
        mealType: 'vegetarian' as const,
      },
      chicken = {
        ...base,
        id: 'chicken',
        name: 'Chicken',
        mealType: 'poultry' as const,
      }
    s.favoriteRecipeIds = ['veg']
    s.recipeUsage = {
      fish: { planned: 5, shopping: 2 },
      veg: { planned: 1, shopping: 0 },
    }
    expect(sortRecipes([fish, veg], s, 'favorites')[0].id).toBe('veg')
    expect(sortRecipes([veg, fish], s, 'popular')[0].id).toBe('fish')
    s.plan = {
      '2026-11-09': 'chicken',
      '2026-11-10': 'chicken',
      '2026-11-11': 'veg',
    }
    expect(rankForDay([fish, veg, chicken], s, '2026-11-12')[0].recipe.id).toBe(
      'fish',
    )
  })
  it('preserves saved days and suggests deliberate leftovers only from an extra batch', () => {
    const s = state()
    const batch = {
      ...base,
      id: 'batch',
      makesLeftovers: true,
      servings: 8,
      mealType: 'vegetarian' as const,
    }
    s.favoriteRecipeIds = ['batch']
    s.plan = { '2099-01-05': base.id }
    const days = ['2099-01-05', '2099-01-06', '2099-01-07']
    const plan = balancedWeek([batch, base], s, days)
    expect(plan[0]?.recipe.id).toBe(base.id)
    expect(plan[0]?.existing).toBe(true)
    expect(plan[1]?.recipe.id).toBe(batch.id)
    expect(plan[1]?.servings).toBe(8)
    expect(plan[2]?.leftoverFrom).toBe(days[1])
    expect(s.plan).toEqual({ '2099-01-05': base.id })
  })
  it('discovery is a complete distinct meal, never a renamed copy of the favorite', () => {
    const s = state()
    const idea = discovery([base], s)!
    expect(idea.name).not.toContain(base.name)
    expect(idea.steps.length).toBeGreaterThan(2)
    expect(idea.ingredients.some((i) => i.productId === 'minced-turkey')).toBe(
      true,
    )
    expect(discovery([base, idea], s)?.id).not.toBe(idea.id)
  })
})

it('uses a saved extra batch as a possible leftover, never a normal-sized or skipped previous lunch', () => {
  const s = state(),
    batch = { ...base, id: 'saved-batch', makesLeftovers: true, servings: 8 }
  s.plan = { '2099-01-05': batch.id }
  s.servings = { '2099-01-05': 8 }
  expect(balancedWeek([batch, base], s, ['2099-01-06'])[0]?.leftoverFrom).toBe(
    '2099-01-05',
  )
  s.servings['2099-01-05'] = 4
  expect(
    balancedWeek([batch, base], s, ['2099-01-05', '2099-01-06'])[1]
      ?.leftoverFrom,
  ).toBeUndefined()
  s.servings['2099-01-05'] = 8
  s.mealFeedback = {
    '2099-01-05': {
      recipeId: batch.id,
      status: 'skipped',
      servings: 8,
      at: '2099-01-05T12:00:00Z',
      rating: null,
      consumed: false,
      automatic: false,
    },
  }
  expect(
    balancedWeek([batch, base], s, ['2099-01-06'])[0]?.leftoverFrom,
  ).toBeUndefined()
})
