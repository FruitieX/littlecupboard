import type { Recipe } from './data'
/** Complete independent ideas, never clones of the top-ranked saved recipe. */
export const discoveryRecipes: Recipe[] = [
  {
    id: 'idea-turkey-carrot-patties',
    name: 'Mild turkey and carrot patties',
    subtitle:
      'A new family experiment: familiar little patties with rice and cucumber. Serve the components separately.',
    image: '/images/recipe-placeholder.svg',
    minutes: 30,
    servings: 4,
    tag: 'New idea',
    tags: ['Candidate', 'Poultry'],
    mealType: 'poultry',
    ingredients: [
      { productId: 'minced-turkey', quantity: 450, unit: 'g' },
      { productId: 'carrots', quantity: 160, unit: 'g' },
      { productId: 'eggs', quantity: 1, unit: 'pc' },
      { productId: 'breadcrumbs', quantity: 40, unit: 'g' },
      { productId: 'rapeseed-oil', quantity: 1, unit: 'tbsp' },
      { productId: 'rice', quantity: 250, unit: 'g' },
      { productId: 'cucumber', quantity: 1, unit: 'pc' },
    ],
    steps: [
      'Heat the oven to 200°C. Cook the rice according to its packet.',
      'Finely grate the carrot and mix with turkey mince, egg and breadcrumbs. Shape into small, evenly sized patties.',
      'Put on a lined tray, brush with oil and bake about 20 minutes until cooked through, at least 75°C internally.',
      'Slice the cucumber. Serve rice, patties and vegetables separately, with adult seasoning added at the table.',
    ],
  },
  {
    id: 'idea-white-fish-parcels',
    name: 'Lemon white fish parcels with potatoes',
    subtitle:
      'A separate new recipe idea: moist white fish baked in paper parcels, with potatoes and carrots alongside.',
    image: '/images/recipe-placeholder.svg',
    minutes: 35,
    servings: 4,
    tag: 'New idea',
    tags: ['Candidate', 'Fish'],
    mealType: 'fish',
    ingredients: [
      { productId: 'cod', quantity: 500, unit: 'g' },
      { productId: 'potatoes', quantity: 800, unit: 'g' },
      { productId: 'carrots', quantity: 300, unit: 'g' },
      { productId: 'lemon', quantity: 1, unit: 'pc' },
      { productId: 'rapeseed-oil', quantity: 1, unit: 'tbsp' },
    ],
    steps: [
      'Heat the oven to 200°C. Cut potatoes and carrots into even pieces and boil until tender.',
      'Divide boneless fish between baking-paper parcels. Add a little oil and lemon juice, fold closed and place on a tray.',
      'Bake about 15–20 minutes, depending on thickness, until fish is cooked through, about 63°C internally.',
      'Open carefully to release steam. Check for bones and serve with the drained vegetables, separately if preferred.',
    ],
  },
  {
    id: 'idea-potato-egg-tray',
    name: 'Potato and egg tray bake',
    subtitle:
      'A simple new way to use cooked potatoes. No onion or garlic; vegetables can stay on the side.',
    image: '/images/recipe-placeholder.svg',
    minutes: 30,
    servings: 4,
    tag: 'New idea',
    tags: ['Candidate', 'Vegetarian'],
    mealType: 'vegetarian',
    ingredients: [
      {
        productId: 'potatoes',
        quantity: 600,
        unit: 'g',
        note: 'Cooked potatoes; allow extra time if starting raw',
      },
      { productId: 'eggs', quantity: 6, unit: 'pc' },
      { productId: 'milk', quantity: 150, unit: 'ml' },
      { productId: 'frozen-spinach', quantity: 150, unit: 'g' },
      { productId: 'rapeseed-oil', quantity: 1, unit: 'tbsp' },
      { productId: 'cucumber', quantity: 1, unit: 'pc' },
    ],
    steps: [
      'Heat the oven to 200°C. Slice safely stored cooked potatoes. Thaw spinach and squeeze out excess water.',
      'Oil a small baking dish and arrange potatoes in it. Whisk eggs and milk, and stir in spinach, or keep spinach as a separate side.',
      'Pour over potatoes and bake about 20–25 minutes until the eggs are fully set.',
      'Serve with sliced cucumber and optional familiar bread. Refrigerate leftovers promptly.',
    ],
  },
]
