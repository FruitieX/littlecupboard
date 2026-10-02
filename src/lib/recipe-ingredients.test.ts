import { expect, it } from 'vitest'
import { replaceRecipeIngredients } from './recipe-ingredients'
import type { Product, Ingredient } from './data'

const products: Product[] = [
  { id: 'rice', name: 'Rice', category: 'Grain products', icon: '🍚' },
  { id: 'barley', name: 'Barley', category: 'Grain products', icon: '🌾' },
]
it('replaces a recipe ingredient without renaming shared items or losing details', () => {
  const ingredient = {
    productId: 'rice',
    quantity: 2.5,
    unit: 'g',
    note: 'rinsed',
  }
  const replaced = replaceRecipeIngredients(
    [ingredient],
    products,
    { rice: 'barley' },
    {},
  )
  expect(replaced.ingredients).toEqual([{ ...ingredient, productId: 'barley' }])
  expect(replaced.created).toEqual([])
  expect(products[0].name).toBe('Rice')
  expect(ingredient.productId).toBe('rice')
})
it('creates one shared ingredient for matching new names and combines amounts and notes', () => {
  const ingredients: Ingredient[] = [
    { productId: 'rice', quantity: 200, unit: 'g', note: 'rinsed' },
    { productId: 'barley', quantity: 50, unit: 'g', note: 'soaked' },
  ]
  const replaced = replaceRecipeIngredients(
    ingredients,
    products,
    { rice: 'Millet flakes', barley: 'millet flakes' },
    { rice: 'Ingredients' },
  )
  expect(replaced.created).toHaveLength(1)
  expect(replaced.created[0]).toMatchObject({
    name: 'Millet flakes',
    category: 'Ingredients',
    icon: '🛒',
  })
  expect(replaced.ingredients).toEqual([
    {
      productId: replaced.created[0].id,
      quantity: 250,
      unit: 'g',
      note: 'rinsed; soaked',
    },
  ])
  expect(ingredients[0].quantity).toBe(200)
})
it('rejects blank names and incompatible duplicate units instead of losing an ingredient', () => {
  expect(() =>
    replaceRecipeIngredients(
      [{ productId: 'rice', quantity: 1, unit: 'pc' }],
      products,
      { rice: ' ' },
      {},
    ),
  ).toThrow('name')
  expect(() =>
    replaceRecipeIngredients(
      [
        { productId: 'rice', quantity: 1, unit: 'pc' },
        { productId: 'barley', quantity: 100, unit: 'g' },
      ],
      products,
      { rice: 'Barley' },
      {},
    ),
  ).toThrow('same unit')
})
