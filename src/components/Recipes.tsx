import { getProducts } from '../lib/catalog'
import { deleteRecipe } from '../lib/catalog'
import { useEffect, useState } from 'react'
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
import { findProduct } from '../lib/data'
import type { Recipe, Ingredient } from '../lib/data'
import { useApp } from '../lib/state'
import { EmptyState, Modal } from './ui'
import { FoodIcon } from './FoodIcon'
import { ImageField } from './ImageField'
import { Markdown } from './Markdown'
import { discovery } from '../lib/learning'
import {
  availableRecipeTags,
  hasRecipeTag,
  normalizeTags,
  recipeTags,
} from '../lib/recipe-tags'
import { RecipeTagsInput } from './RecipeTagsInput'
import { RecipeSources } from './RecipeSources'

export function Recipes() {
  const { state, update, allRecipes } = useApp()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<{
    kind: 'all' | 'favorites' | 'quick' | 'tag'
    tag?: string
  }>({ kind: 'all' })
  const [selected, setSelected] = useState<Recipe | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [editing, setEditing] = useState<Recipe | null>(null)
  const newIdea = discovery(allRecipes, state)
  const tags = availableRecipeTags(allRecipes)
  useEffect(() => {
    if (
      filter.kind === 'tag' &&
      !tags.some((tag) => tag.toLowerCase() === filter.tag?.toLowerCase())
    )
      setFilter({ kind: 'all' })
  }, [filter, tags.join('\n')])
  const visible = allRecipes.filter(
    (r) =>
      `${r.name} ${r.subtitle} ${recipeTags(r).join(' ')}`
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (filter.kind === 'all' ||
        (filter.kind === 'favorites' &&
          state.favoriteRecipeIds.includes(r.id)) ||
        (filter.kind === 'quick' && r.minutes <= 20) ||
        (filter.kind === 'tag' && hasRecipeTag(r, filter.tag!))),
  )
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>
            Our recipe book<span className="heading-dot">.</span>
          </h1>
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
      {allRecipes[0] && (
        <div className="recipe-banner">
          <div>
            <span className="banner-overline">FROM OUR KITCHEN</span>
            <h2>{allRecipes[0].name}</h2>
            <Markdown compact>{allRecipes[0].subtitle}</Markdown>
            <button onClick={() => setSelected(allRecipes[0])}>
              Take a look <ArrowUpRight size={18} />
            </button>
          </div>
          <img src={allRecipes[0].image} alt={allRecipes[0].name} />
          <span className="banner-flower">✳</span>
        </div>
      )}
      {newIdea && (
        <section className="discovery-card">
          <span className="eyebrow">SUGGESTED RECIPE</span>
          <h3>{newIdea.name}</h3>
          <Markdown compact>{newIdea.subtitle}</Markdown>
          <div className="recipe-manage">
            <button
              className="secondary-button"
              onClick={() => {
                setEditing(newIdea)
              }}
            >
              Review & save variation
            </button>
            <button
              className="text-button"
              onClick={() =>
                update((s) => ({
                  ...s,
                  suggestionFeedback: {
                    ...s.suggestionFeedback,
                    [newIdea.id]: {
                      status: 'dismissed',
                      at: new Date().toISOString(),
                      until: null,
                    },
                  },
                }))
              }
            >
              Dismiss
            </button>
          </div>
        </section>
      )}
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
        {(
          [
            { kind: 'all', label: 'All recipes' },
            { kind: 'favorites', label: 'Favorites' },
            { kind: 'quick', label: 'Quick & easy' },
          ] as const
        ).map(({ kind, label }) => (
          <button
            key={label}
            aria-pressed={filter.kind === kind}
            className={filter.kind === kind ? 'selected' : ''}
            onClick={() => setFilter({ kind })}
          >
            {label === 'Favorites' && <Heart size={14} />}
            {label}
          </button>
        ))}
        {tags.map((tag) => (
          <button
            key={`tag:${tag}`}
            aria-label={`Filter by tag ${tag}`}
            aria-pressed={filter.kind === 'tag' && filter.tag === tag}
            className={
              filter.kind === 'tag' && filter.tag === tag ? 'selected' : ''
            }
            onClick={() => setFilter({ kind: 'tag', tag })}
          >
            {['All recipes', 'Favorites', 'Quick & easy'].includes(tag)
              ? `${tag} · tag`
              : tag}
          </button>
        ))}
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
                <Markdown compact>{recipe.subtitle}</Markdown>
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
        <RecipeDetail
          recipe={selected}
          onClose={() => setSelected(null)}
          onEdit={() => {
            setEditing(selected)
            setSelected(null)
          }}
        />
      )}
      {(createOpen || editing) && (
        <RecipeEditor
          recipe={editing ?? undefined}
          onClose={() => {
            setCreateOpen(false)
            setEditing(null)
          }}
        />
      )}
    </>
  )
}

export function RecipeDetail({
  recipe,
  onClose,
  onEdit,
}: {
  recipe: Recipe
  onClose: () => void
  onEdit?: () => void
}) {
  const { action, state, update } = useApp()
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
      description={`${recipe.minutes} minutes · ${recipe.servings} servings`}
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
        <Markdown>{recipe.subtitle}</Markdown>
        <RecipeSources sources={recipe.sourceImages} />
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
            const product =
              getProducts(state).find(
                (product) => product.id === ingredient.productId,
              ) ?? findProduct(ingredient.productId)
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
                  <FoodIcon
                    image={state.productImages?.[product.id] || product.image}
                    value={product.icon}
                  />
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
            action({
              type: 'addIngredients',
              ingredients: recipe.ingredients.filter((i) =>
                include.includes(i.productId),
              ),
              multiplier,
            })
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
              <Markdown>{step}</Markdown>
            </li>
          ))}
        </ol>
        <div className="recipe-manage">
          {onEdit && (
            <button className="secondary-button" onClick={onEdit}>
              Edit recipe
            </button>
          )}
          <button
            className="text-button danger"
            onClick={() => {
              if (
                !confirm(
                  'Delete this recipe and remove it from planned lunches?',
                )
              )
                return
              update((s) => deleteRecipe(s, recipe.id))
              onClose()
            }}
          >
            Delete recipe
          </button>
        </div>
      </div>
    </Modal>
  )
}

export function RecipeEditor({
  onClose,
  recipe,
}: {
  onClose: () => void
  recipe?: Recipe
}) {
  const { state, update, groups, allRecipes } = useApp()
  const [name, setName] = useState(recipe?.name ?? '')
  const [subtitle, setSubtitle] = useState(recipe?.subtitle ?? '')
  const [minutes, setMinutes] = useState(recipe?.minutes ?? 20)
  const [servings, setServings] = useState(
    recipe?.servings ?? state.preferences?.servings ?? 4,
  )
  const [steps, setSteps] = useState(recipe?.steps.join('\n') ?? '')
  const [ingredients, setIngredients] = useState<Ingredient[]>(
    recipe?.ingredients ?? [],
  )
  const [ingredientName, setIngredientName] = useState('')
  const [group, setGroup] = useState(groups[0])
  const [quantity, setQuantity] = useState(1)
  const [unit, setUnit] = useState('pc')
  const [note, setNote] = useState('')
  const [image, setImage] = useState(recipe?.image ?? '')
  const [tags, setTags] = useState(
    recipe?.tags?.join(', ') ?? recipe?.tag ?? '',
  )
  const knownTags = availableRecipeTags(allRecipes)
  const [sources, setSources] = useState(recipe?.sourceImages ?? [])
  const [products, setProducts] = useState(state.customProducts)
  const [uploadCount, setUploadCount] = useState(0)
  const pictureBusy = (busy: boolean) =>
    setUploadCount((count) => Math.max(0, count + (busy ? 1 : -1)))
  const [pictures, setPictures] = useState(state.productImages ?? {})
  const [error, setError] = useState('')
  const knownProducts = getProducts({ ...state, customProducts: products })
  const choices = knownProducts.filter(
    (product) => !state.archivedProductIds?.includes(product.id),
  )
  function addIngredient() {
    if (!ingredientName.trim() || quantity <= 0 || !unit.trim()) return
    let product = choices.find(
      (p) => p.name.toLowerCase() === ingredientName.trim().toLowerCase(),
    )
    if (!product) {
      product = {
        id: crypto.randomUUID(),
        name: ingredientName.trim(),
        category: group,
        icon: '🛒',
        aliases: [],
      }
      setProducts((p) => [...p, product!])
    }
    const match = ingredients.find((i) => i.productId === product.id)
    if (match && match.unit !== unit) {
      setError('Choose the same unit for repeated ingredients.')
      return
    }
    setIngredients((list) =>
      match
        ? list.map((i) =>
            i === match
              ? { ...i, quantity: i.quantity + quantity, note: note || i.note }
              : i,
          )
        : [...list, { productId: product.id, quantity, unit, note }],
    )
    setIngredientName('')
    setNote('')
    setError('')
  }
  return (
    <Modal
      open
      onOpenChange={(v) => {
        if (!v) onClose()
      }}
      title={recipe ? 'Edit recipe' : 'Create recipe'}
      description="Ingredients, method, and recipe notes."
    >
      <form
        className="editor-form"
        onSubmit={(event) => {
          event.preventDefault()
          if (!ingredients.length) {
            setError('Add at least one ingredient.')
            return
          }
          const savedTags = normalizeTags(tags, knownTags)
          if (
            savedTags.length > 20 ||
            savedTags.some((tag) => [...tag].length > 60)
          ) {
            setError('Use up to 20 tags, with at most 60 characters each.')
            return
          }
          const saved: Recipe = {
            id: recipe?.id ?? crypto.randomUUID(),
            name: name.trim(),
            subtitle: subtitle.trim(),
            image: image || '/images/recipe-placeholder.svg',
            minutes,
            servings,
            tag: savedTags[0] || 'Our recipe',
            tags: savedTags,
            ...(sources.length ? { sourceImages: sources } : {}),
            ingredients,
            steps: steps
              .split('\n')
              .map((t) => t.trim())
              .filter(Boolean),
          }
          update((s) => ({
            ...s,
            productImages: pictures,
            customProducts: [
              ...s.customProducts,
              ...products.filter(
                (p) => !s.customProducts.some((x) => x.id === p.id),
              ),
            ],
            recipeBook: [
              ...(s.recipeBook ?? []),
              ...(!recipe || !s.recipeBook?.some((r) => r.id === recipe.id)
                ? [saved]
                : []),
            ].map((r) => (r.id === saved.id ? saved : r)),
            customRecipes: s.customRecipes.filter((r) => r.id !== saved.id),
          }))
          onClose()
        }}
      >
        <label>
          Recipe name
          <input
            autoFocus
            required
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          Description
          <textarea
            aria-label="Description"
            rows={5}
            maxLength={8000}
            value={subtitle}
            onChange={(e) => setSubtitle(e.target.value)}
            placeholder="A family favorite. Use **bold**, lists, headings and links for notes."
          />
          <small>
            Markdown supported: **bold**, *italic*, lists, headings and links.
          </small>
        </label>
        {!!subtitle.trim() && (
          <details className="description-preview">
            <summary>Preview description</summary>
            <Markdown>{subtitle}</Markdown>
          </details>
        )}
        <div className="form-row">
          <label>
            Minutes
            <input
              type="number"
              min={1}
              max={1440}
              required
              value={minutes}
              onChange={(e) => setMinutes(Number(e.target.value))}
            />
          </label>
          <label>
            Servings
            <input
              type="number"
              min={1}
              max={100}
              required
              value={servings}
              onChange={(e) => setServings(Number(e.target.value))}
            />
          </label>
        </div>
        <RecipeTagsInput value={tags} onChange={setTags} options={knownTags} />
        <RecipeSources sources={sources} onChange={setSources} />
        <ImageField
          value={image}
          onChange={setImage}
          subject={name}
          onBusyChange={pictureBusy}
        />
        <fieldset className="ingredient-editor">
          <legend>Ingredients</legend>
          <label>
            Ingredient
            <input
              aria-label="Ingredient"
              list="recipe-products"
              value={ingredientName}
              onChange={(e) => setIngredientName(e.target.value)}
              placeholder="Search or name a new ingredient"
              maxLength={100}
            />
            <datalist id="recipe-products">
              {choices.map((p) => (
                <option key={p.id} value={p.name} />
              ))}
            </datalist>
          </label>
          {!choices.some(
            (p) => p.name.toLowerCase() === ingredientName.toLowerCase(),
          ) &&
            ingredientName && (
              <label>
                New ingredient group
                <select
                  value={group}
                  onChange={(e) => setGroup(e.target.value)}
                >
                  {groups.map((g) => (
                    <option key={g}>{g}</option>
                  ))}
                </select>
              </label>
            )}
          <div className="form-row">
            <label>
              Quantity
              <input
                type="number"
                min="0.01"
                step="any"
                value={quantity}
                onChange={(e) => setQuantity(Number(e.target.value))}
              />
            </label>
            <label>
              Unit
              <input
                value={unit}
                maxLength={30}
                onChange={(e) => setUnit(e.target.value)}
              />
            </label>
          </div>
          <label>
            Ingredient details
            <input
              value={note}
              maxLength={500}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. finely chopped, preferred brand"
            />
          </label>
          <button
            type="button"
            className="secondary-button"
            disabled={!ingredientName.trim() || quantity <= 0 || !unit.trim()}
            onClick={addIngredient}
          >
            <Plus size={16} /> Add ingredient
          </button>
          <div className="editable-ingredients">
            {ingredients.map((ingredient) => {
              const product = knownProducts.find(
                (p) => p.id === ingredient.productId,
              )!
              return (
                <details key={ingredient.productId}>
                  <summary>
                    <FoodIcon
                      value={product.icon}
                      image={pictures[product.id] || product.image}
                    />
                    <strong>{product.name}</strong>
                    <span>
                      {ingredient.quantity} {ingredient.unit}
                    </span>
                  </summary>
                  <div className="editor-form">
                    <div className="form-row">
                      <label>
                        Amount of {product.name}
                        <input
                          type="number"
                          min="0.01"
                          step="any"
                          required
                          value={ingredient.quantity}
                          onChange={(event) =>
                            setIngredients((list) =>
                              list.map((i) =>
                                i.productId === product.id
                                  ? {
                                      ...i,
                                      quantity: Number(event.target.value),
                                    }
                                  : i,
                              ),
                            )
                          }
                        />
                      </label>
                      <label>
                        Unit for {product.name}
                        <input
                          value={ingredient.unit}
                          required
                          maxLength={30}
                          onChange={(event) =>
                            setIngredients((list) =>
                              list.map((i) =>
                                i.productId === product.id
                                  ? { ...i, unit: event.target.value }
                                  : i,
                              ),
                            )
                          }
                        />
                      </label>
                    </div>
                    <label>
                      Details for {product.name}
                      <input
                        maxLength={500}
                        value={ingredient.note ?? ''}
                        onChange={(event) =>
                          setIngredients((list) =>
                            list.map((i) =>
                              i.productId === product.id
                                ? { ...i, note: event.target.value }
                                : i,
                            ),
                          )
                        }
                      />
                    </label>
                    <ImageField
                      kind="item"
                      value={pictures[product.id] || product.image || ''}
                      onChange={(image) =>
                        setPictures((current) => ({
                          ...current,
                          [product.id]: image,
                        }))
                      }
                      subject={product.name}
                      onBusyChange={pictureBusy}
                    />
                    <button
                      type="button"
                      className="text-button danger"
                      aria-label={`Remove ${product.name} ingredient`}
                      onClick={() =>
                        setIngredients((list) =>
                          list.filter((i) => i.productId !== product.id),
                        )
                      }
                    >
                      <Minus size={14} />
                      Remove ingredient
                    </button>
                  </div>
                </details>
              )
            })}
          </div>
        </fieldset>
        <label>
          How to make it
          <textarea
            rows={5}
            required
            value={steps}
            onChange={(e) => setSteps(e.target.value)}
            maxLength={10000}
            placeholder="One step per line…"
          />
        </label>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <button
          className="primary-button"
          type="submit"
          disabled={uploadCount > 0}
        >
          <Check size={18} />
          Save to our recipe book
        </button>
      </form>
    </Modal>
  )
}
