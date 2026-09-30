import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  Search,
  Plus,
  Heart,
  Clock3,
  Users,
  ShoppingBasket,
  Check,
  Minus,
  ArrowUpRight,
  BookOpen,
} from 'lucide-react'
import { catalog, findProduct } from '../lib/data'
import type { Recipe, Ingredient } from '../lib/data'
import { useApp } from '../lib/state'
import { addIngredients } from '../lib/shopping'
import { EmptyState, Eyebrow, Modal } from './ui'
import { FoodIcon } from './FoodIcon'

export function Recipes() {
  const { state, update, allRecipes } = useApp()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('All recipes')
  const [selected, setSelected] = useState<Recipe | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const visible = allRecipes.filter(
    (r) =>
      r.name.toLowerCase().includes(query.toLowerCase()) &&
      (filter === 'All recipes' ||
        (filter === 'Favorites' && state.favoriteRecipeIds.includes(r.id)) ||
        (filter === 'Quick & easy' && r.minutes <= 20) ||
        (filter === 'Vegetarian' && r.tag === 'Vegetarian')),
  )
  return (
    <>
      <div className="page-heading">
        <div>
          <Eyebrow>GOOD FOOD, WORTH KEEPING</Eyebrow>
          <h1>
            Our recipe book<span className="heading-dot">.</span>
          </h1>
          <p>The tried, the loved, and the “let’s make that again.”</p>
        </div>
        <button
          className="primary-button add-recipe-button"
          aria-label="Add recipe"
          onClick={() => setCreateOpen(true)}
        >
          <Plus size={18} />
          <span>Add recipe</span>
        </button>
      </div>
      <div className="recipe-banner">
        <div>
          <span className="banner-overline">A FAMILY FAVORITE</span>
          <h2>
            A little green.
            <br />A lot of goodness.
          </h2>
          <p>20 minutes to a very happy table.</p>
          <button onClick={() => setSelected(allRecipes[0])}>
            Make green goddess pasta <ArrowUpRight size={18} />
          </button>
        </div>
        <img src="/images/pasta.jpg" alt="Fresh green pasta with tomatoes" />
        <span className="banner-flower">✳</span>
      </div>
      <div className="recipe-tools">
        <label className="recipe-search">
          <Search size={19} />
          <input
            aria-label="Search recipes"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find something delicious…"
          />
        </label>
        <span className="recipe-total">
          <BookOpen size={15} />
          {allRecipes.length} recipes, plenty of possibilities
        </span>
      </div>
      <div className="filter-chips" aria-label="Filter recipes">
        {['All recipes', 'Favorites', 'Quick & easy', 'Vegetarian'].map(
          (label) => (
            <button
              key={label}
              aria-pressed={filter === label}
              className={filter === label ? 'selected' : ''}
              onClick={() => setFilter(label)}
            >
              {label === 'Favorites' && <Heart size={14} />}
              {label}
            </button>
          ),
        )}
      </div>
      <div className="recipe-grid">
        <AnimatePresence mode="popLayout">
          {visible.map((recipe, i) => (
            <motion.article
              key={recipe.id}
              layout
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ delay: i * 0.025 }}
              className="recipe-card"
            >
              <div className="recipe-card-image">
                <button
                  onClick={() => setSelected(recipe)}
                  aria-label={`Open ${recipe.name}`}
                >
                  <img src={recipe.image} alt={recipe.name} loading="lazy" />
                </button>
                <button
                  className={`favorite-button ${state.favoriteRecipeIds.includes(recipe.id) ? 'is-favorite' : ''}`}
                  aria-label={`${state.favoriteRecipeIds.includes(recipe.id) ? 'Unfavorite' : 'Favorite'} ${recipe.name}`}
                  aria-pressed={state.favoriteRecipeIds.includes(recipe.id)}
                  onClick={() =>
                    update((s) => ({
                      ...s,
                      favoriteRecipeIds: s.favoriteRecipeIds.includes(recipe.id)
                        ? s.favoriteRecipeIds.filter((id) => id !== recipe.id)
                        : [...s.favoriteRecipeIds, recipe.id],
                    }))
                  }
                >
                  <Heart size={18} />
                </button>
                <span
                  className={`recipe-tag ${recipe.tag === 'Vegetarian' ? 'vegetarian' : ''}`}
                >
                  {recipe.tag}
                </span>
              </div>
              <button
                className="recipe-card-body"
                onClick={() => setSelected(recipe)}
              >
                <h3>{recipe.name}</h3>
                <p>{recipe.subtitle}</p>
                <div>
                  <span>
                    <Clock3 size={14} />
                    {recipe.minutes} min
                  </span>
                  <span>
                    <Users size={14} />
                    {recipe.servings}
                  </span>
                  <ArrowUpRight size={18} />
                </div>
              </button>
            </motion.article>
          ))}
        </AnimatePresence>
      </div>
      {!visible.length && (
        <EmptyState
          icon="🥣"
          title="Nothing simmering here yet"
          text="Try another search or add a recipe your family loves."
        />
      )}
      {selected && (
        <RecipeDetail recipe={selected} onClose={() => setSelected(null)} />
      )}
      {createOpen && <RecipeEditor onClose={() => setCreateOpen(false)} />}
    </>
  )
}

export function RecipeDetail({
  recipe,
  onClose,
}: {
  recipe: Recipe
  onClose: () => void
}) {
  const { update } = useApp()
  const [servings, setServings] = useState(recipe.servings)
  const [include, setInclude] = useState<string[]>(
    recipe.ingredients.map((i) => i.productId),
  )
  const [added, setAdded] = useState(false)
  const multiplier = servings / recipe.servings
  return (
    <Modal
      open
      onOpenChange={(v) => {
        if (!v) onClose()
      }}
      title={recipe.name}
      description={recipe.subtitle}
      className="recipe-detail"
    >
      <img
        className="recipe-detail-image"
        src={recipe.image}
        alt={recipe.name}
      />
      <div className="detail-content">
        <div className="detail-meta">
          <span>
            <Clock3 size={16} />
            {recipe.minutes} minutes
          </span>
          <span
            className={`recipe-tag ${recipe.tag === 'Vegetarian' ? 'vegetarian' : ''}`}
          >
            {recipe.tag}
          </span>
        </div>
        <div className="ingredients-heading">
          <h3>Gather the good stuff</h3>
          <div className="servings-control">
            <button
              aria-label="Fewer servings"
              disabled={servings <= 1}
              onClick={() => {
                setServings((s) => s - 1)
                setAdded(false)
              }}
            >
              <Minus size={14} />
            </button>
            <span>{servings} servings</span>
            <button
              aria-label="More servings"
              disabled={servings >= 20}
              onClick={() => {
                setServings((s) => s + 1)
                setAdded(false)
              }}
            >
              <Plus size={14} />
            </button>
          </div>
        </div>
        <p className="ingredient-hint">
          Already have something? Untick it before adding.
        </p>
        <div className="ingredient-list">
          {recipe.ingredients.map((ingredient) => {
            const product = findProduct(ingredient.productId)
            return (
              <label key={ingredient.productId}>
                <input
                  type="checkbox"
                  checked={include.includes(ingredient.productId)}
                  onChange={(e) => {
                    setInclude((current) =>
                      e.target.checked
                        ? [...current, ingredient.productId]
                        : current.filter((id) => id !== ingredient.productId),
                    )
                    setAdded(false)
                  }}
                />
                <span className="ingredient-emoji">
                  <FoodIcon value={product.icon} />
                </span>
                <span>{product.name}</span>
                <strong>
                  {Number((ingredient.quantity * multiplier).toFixed(2))}{' '}
                  {ingredient.unit}
                </strong>
              </label>
            )
          })}
        </div>
        <button
          className="primary-button ingredient-add"
          disabled={!include.length}
          onClick={() => {
            update((s) => ({
              ...s,
              items: addIngredients(
                s.items,
                recipe.ingredients.filter((i) => include.includes(i.productId)),
                multiplier,
              ),
            }))
            setAdded(true)
          }}
        >
          {added ? <Check size={18} /> : <ShoppingBasket size={18} />}
          {added
            ? 'Added to our shopping list'
            : `Add ${include.length} ingredients to list`}
        </button>
        <p className="merge-note" role="status">
          {added
            ? 'Everything’s on the list. Matching ingredients were merged.'
            : 'One shared list. Matching ingredients merge automatically.'}
        </p>
        <h3 className="method-heading">Let’s make something good</h3>
        <ol className="recipe-steps">
          {recipe.steps.map((step, i) => (
            <li key={i}>
              <span>{i + 1}</span>
              <p>{step}</p>
            </li>
          ))}
        </ol>
      </div>
    </Modal>
  )
}

function RecipeEditor({ onClose }: { onClose: () => void }) {
  const { update } = useApp()
  const [name, setName] = useState('')
  const [minutes, setMinutes] = useState(20)
  const [servings, setServings] = useState(4)
  const [steps, setSteps] = useState('')
  const [ingredients, setIngredients] = useState<Ingredient[]>([])
  const [product, setProduct] = useState(catalog[0].id)
  const [quantity, setQuantity] = useState(1)
  const [unit, setUnit] = useState('pc')
  const [image, setImage] = useState('/images/salad.jpg')
  const [error, setError] = useState('')
  return (
    <Modal
      open
      onOpenChange={(v) => {
        if (!v) onClose()
      }}
      title="Keep a good thing"
      description="Save a recipe your family loves. A photo makes it even easier to find."
    >
      <form
        className="editor-form"
        onSubmit={(e) => {
          e.preventDefault()
          if (!ingredients.length) {
            setError('Add at least one ingredient.')
            return
          }
          const recipe: Recipe = {
            id: crypto.randomUUID(),
            name: name.trim(),
            subtitle: 'From our family kitchen.',
            image,
            minutes,
            servings,
            tag: 'Our recipe',
            ingredients,
            steps: steps
              .split('\n')
              .map((s) => s.trim())
              .filter(Boolean),
          }
          update((s) => ({ ...s, customRecipes: [...s.customRecipes, recipe] }))
          onClose()
        }}
      >
        <label>
          Recipe name
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={100}
            placeholder="e.g. Grandma’s vegetable soup"
          />
        </label>
        <div className="form-row">
          <label>
            Minutes
            <input
              type="number"
              value={minutes}
              min={1}
              max={1440}
              onChange={(e) => setMinutes(Number(e.target.value))}
              required
            />
          </label>
          <label>
            Servings
            <input
              type="number"
              min={1}
              max={20}
              value={servings}
              onChange={(e) => setServings(Number(e.target.value))}
              required
            />
          </label>
        </div>
        <label>
          Photo{' '}
          <span className="optional">
            optional · JPG, PNG, WebP · up to 500 KB
          </span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (!file) return
              if (
                !['image/jpeg', 'image/png', 'image/webp'].includes(
                  file.type,
                ) ||
                file.size > 500000
              ) {
                setError('Choose a JPG, PNG, or WebP under 500 KB.')
                e.target.value = ''
                return
              }
              const reader = new FileReader()
              reader.onload = () => {
                setImage(String(reader.result))
                setError('')
              }
              reader.readAsDataURL(file)
            }}
          />
        </label>
        <fieldset className="ingredient-editor">
          <legend>Ingredients</legend>
          <label>
            Ingredient
            <select
              value={product}
              onChange={(e) => setProduct(e.target.value)}
            >
              {catalog.map((p) => (
                <option value={p.id} key={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <div className="form-row">
            <label>
              Quantity
              <input
                type="number"
                value={quantity}
                min="0.01"
                step="any"
                onChange={(e) => setQuantity(Number(e.target.value))}
              />
            </label>
            <label>
              Unit
              <input
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                maxLength={20}
              />
            </label>
          </div>
          <button
            type="button"
            className="secondary-button"
            disabled={quantity <= 0 || !unit.trim()}
            onClick={() => {
              setIngredients((current) => {
                const match = current.find((i) => i.productId === product)
                if (match && match.unit !== unit) {
                  setError(
                    'Use the same unit when adding this ingredient again.',
                  )
                  return current
                }
                setError('')
                return match
                  ? current.map((i) =>
                      i.productId === product
                        ? { ...i, quantity: i.quantity + quantity }
                        : i,
                    )
                  : [...current, { productId: product, quantity, unit }]
              })
            }}
          >
            <Plus size={16} />
            Add ingredient
          </button>
          <div className="new-ingredients">
            {ingredients.map((i) => (
              <div key={i.productId}>
                <span>{findProduct(i.productId).name}</span>
                <strong>
                  {i.quantity} {i.unit}
                </strong>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Remove ${findProduct(i.productId).name} ingredient`}
                  onClick={() =>
                    setIngredients((list) =>
                      list.filter((x) => x.productId !== i.productId),
                    )
                  }
                >
                  <Minus size={14} />
                </button>
              </div>
            ))}
          </div>
        </fieldset>
        <label>
          How to make it
          <textarea
            rows={4}
            required
            value={steps}
            onChange={(e) => setSteps(e.target.value)}
            placeholder="One step per line…"
            maxLength={5000}
          />
        </label>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <button className="primary-button" type="submit">
          <Check size={18} />
          Save to our recipe book
        </button>
      </form>
    </Modal>
  )
}
