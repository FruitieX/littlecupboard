import { describe, expect, it } from 'vitest'
import { initialState, recipes } from './data'
import {
  matchesSearch,
  productSearchFields,
  recipeSearchFields,
} from './search'

describe('search', () => {
  it('matches every word across fields, ignoring case and accents', () => {
    expect(matchesSearch(['Crème fraîche', 'Milk & eggs'], 'creme milk')).toBe(
      true,
    )
    expect(matchesSearch(['Crème fraîche'], 'creme cheese')).toBe(false)
    expect(matchesSearch(['Anything'], '  ')).toBe(true)
  })
  it('finds items by other names and notes, recipes by ingredients', () => {
    const state = initialState()
    state.items = [
      {
        id: 'custom-dip',
        name: 'Dip',
        category: 'Snacks',
        icon: '🛒',
        aliases: ['salsa'],
        quantity: 1,
        unit: 'pc',
        note: 'Spicy green one',
        checked: false,
      },
    ]
    const dip = {
      id: 'custom-dip',
      name: 'Dip',
      category: 'Snacks',
      icon: '🛒',
      aliases: ['salsa'],
    }
    expect(matchesSearch(productSearchFields(state, dip), 'salsa')).toBe(true)
    expect(matchesSearch(productSearchFields(state, dip), 'green')).toBe(true)
    const pasta = recipes.find((recipe) => recipe.id === 'green-pasta')!
    expect(matchesSearch(recipeSearchFields(state, pasta), 'spinach')).toBe(
      true,
    )
  })
})
