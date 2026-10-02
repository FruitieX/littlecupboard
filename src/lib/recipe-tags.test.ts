import { describe, expect, it } from 'vitest'
import {
  availableRecipeTags,
  hasRecipeTag,
  normalizeTags,
  recipeTags,
} from './recipe-tags'
import { recipes } from './data'

describe('recipe tags', () => {
  it('trims and deduplicates tags and reuses existing spelling', () => {
    expect(
      normalizeTags(' lunchbox, vegetarian, LUNCHBOX, , Quick   lunch ', [
        'Vegetarian',
      ]),
    ).toEqual(['lunchbox', 'Vegetarian', 'Quick lunch'])
  })
  it('finds filters from legacy and custom tags and matches every tag', () => {
    const recipe = {
      ...recipes[0],
      tag: 'Family favorite',
      tags: ['Lunchbox', 'Vegetarian', 'lunchbox'],
    }
    expect(recipeTags(recipe)).toEqual([
      'Lunchbox',
      'Vegetarian',
      'Family favorite',
    ])
    expect(
      availableRecipeTags([recipe, { ...recipe, tags: ['LUNCHBOX'] }]),
    ).toEqual(['Family favorite', 'Lunchbox', 'Vegetarian'])
    expect(hasRecipeTag(recipe, 'vegetarian')).toBe(true)
    expect(hasRecipeTag(recipe, 'Lunchbox')).toBe(true)
    expect(hasRecipeTag(recipe, 'Imported')).toBe(false)
  })
})
