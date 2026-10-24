import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useLearning } from '../lib/learning'
import type { ConsumptionRate } from '../lib/api/ConsumptionRate'
import { AliasInput } from './AliasInput'
import {
  matchesSearch,
  productSearchFields,
  recipeSearchFields,
} from '../lib/search'
import { approveAiAdded } from '../lib/ai-added'
import { defaultShelfLifeDays, shelfLifeDays } from '../lib/shelf-life'
import {
  ConsumptionFields,
  ShelfLifeFields,
  rateLabel,
} from './ConsumptionFields'
import { LoaderCircle, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react'
import { post } from '../lib/http'
import type { ShelfLifeEstimate } from '../lib/api/ShelfLifeEstimate'
import { useApp } from '../lib/state'
import { catalog, type Product, type Recipe } from '../lib/data'
import {
  archiveProduct,
  deleteProduct,
  deleteRecipe,
  getProducts,
  saveProduct,
} from '../lib/catalog'
import { Modal, SectionTitle } from './ui'
import { FoodIcon } from './FoodIcon'
import { ImageField } from './ImageField'
import { RecipeEditor } from './Recipes'

export function LibrarySettings({ section }: { section: 'items' | 'recipes' }) {
  const { state, allRecipes, update, session, status } = useApp()
  const { insights } = useLearning()
  const [query, setQuery] = useState('')
  const [recipeQuery, setRecipeQuery] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [product, setProduct] = useState<Product | 'new' | null>(null)
  const [recipe, setRecipe] = useState<Recipe | 'new' | null>(null)
  const [removeRecipe, setRemoveRecipe] = useState<Recipe | null>(null)
  const [limit, setLimit] = useState(30)
  const [estimating, setEstimating] = useState(false)
  const [estimateMessage, setEstimateMessage] = useState('')
  // Built-in items come with shelf lives; ask the assistant for our own.
  async function estimateShelfLives() {
    setEstimating(true)
    setEstimateMessage('')
    try {
      const estimates = await post<ShelfLifeEstimate[]>('/ai/shelf-lives', {})
      const known = estimates.filter(
        (estimate): estimate is ShelfLifeEstimate & { days: number } =>
          estimate.days !== null,
      )
      if (known.length)
        update(
          (current) => ({
            ...current,
            shelfLifeDays: {
              ...current.shelfLifeDays,
              ...Object.fromEntries(
                known
                  .filter(
                    (estimate) =>
                      current.shelfLifeDays?.[estimate.productId] === undefined,
                  )
                  .map((estimate) => [estimate.productId, estimate.days]),
              ),
            },
          }),
          'Estimate shelf lives',
        )
      setEstimateMessage(
        estimates.length
          ? `Set shelf lives for ${known.length} of your items; ${estimates.length - known.length} keep for months or don’t spoil. Undo from Cupboard → History.`
          : 'All of your own items already have a shelf life setting.',
      )
    } catch (error) {
      setEstimateMessage(
        error instanceof Error ? error.message : 'Please try again.',
      )
    } finally {
      setEstimating(false)
    }
  }
  const products = getProducts(state)
    .filter(
      (entry) =>
        !entry.oneOff &&
        !!state.archivedProductIds?.includes(entry.id) === showArchived,
    )
    .filter((entry) => matchesSearch(productSearchFields(state, entry), query))
    .sort((a, b) => a.name.localeCompare(b.name))
  const recipes = allRecipes.filter((entry) =>
    matchesSearch(recipeSearchFields(state, entry), recipeQuery),
  )
  return (
    <>
      {section === 'items' && (
        <section className="settings-card">
          <SectionTitle
            title={showArchived ? 'Archived items' : 'Item catalog'}
            count={getProducts(state, false).length}
          />
          <div className="settings-management">
            <p className="settings-description">
              Edit names, groups, search aliases and pictures. Archive items to
              hide them from suggestions while keeping existing lists and recipe
              ingredients.
            </p>
            <div className="editor-form">
              <label>
                Search items
                <input
                  aria-label="Search managed items"
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value)
                    setLimit(30)
                  }}
                />
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={showArchived}
                  onChange={(event) => {
                    setShowArchived(event.target.checked)
                    setLimit(30)
                  }}
                />
                Show archived items
              </label>
              {session.aiEnabled && (
                <button
                  type="button"
                  className="secondary-button"
                  disabled={estimating || status === 'offline'}
                  onClick={() => void estimateShelfLives()}
                >
                  {estimating ? (
                    <LoaderCircle size={16} className="spin" />
                  ) : (
                    <Sparkles size={16} />
                  )}
                  {estimating
                    ? 'Estimating shelf lives…'
                    : 'Estimate shelf lives with AI'}
                </button>
              )}
              {estimateMessage && (
                <p className="quiet-label" role="status">
                  {estimateMessage}
                </p>
              )}
              <button
                className="secondary-button"
                onClick={() => setProduct('new')}
              >
                <Plus size={16} />
                Create item
              </button>
            </div>
            <div className="settings-managed-list">
              {products.slice(0, limit).map((entry) => (
                <button
                  key={entry.id}
                  className="settings-managed-entry"
                  aria-label={`Edit catalog item ${entry.name}`}
                  onClick={() => setProduct(entry)}
                >
                  <span className="settings-managed-image">
                    <FoodIcon value={entry.icon} image={entry.image} />
                  </span>
                  <span>
                    <strong>{entry.name}</strong>
                    <small>
                      {entry.category}
                      {state.consumptionRates?.[entry.id]
                        ? ` · ${rateLabel(state.consumptionRates[entry.id])}`
                        : insights.habits.find((h) => h.productId === entry.id)
                              ?.estimatedConsumption
                          ? ` · estimated: ${rateLabel(insights.habits.find((h) => h.productId === entry.id)!.estimatedConsumption!)}`
                          : ''}
                      {showArchived ? ' · archived' : ''}
                    </small>
                  </span>
                  <Pencil size={16} />
                </button>
              ))}
            </div>
            {!products.length && (
              <p className="quiet-label">No matching items.</p>
            )}
            {products.length > limit && (
              <LoadMore onVisible={() => setLimit((current) => current + 30)}>
                Loading more items ({products.length - limit})
              </LoadMore>
            )}
          </div>
        </section>
      )}
      {section === 'recipes' && (
        <section className="settings-card">
          <SectionTitle title="Recipe book" count={allRecipes.length} />
          <div className="settings-management">
            <div className="editor-form">
              <label>
                Search recipes
                <input
                  aria-label="Search managed recipes"
                  value={recipeQuery}
                  onChange={(event) => setRecipeQuery(event.target.value)}
                />
              </label>
              <button
                className="secondary-button"
                onClick={() => setRecipe('new')}
              >
                <Plus size={16} />
                Create recipe
              </button>
            </div>
            <div className="settings-managed-list">
              {recipes.map((entry) => (
                <div key={entry.id} className="settings-managed-entry">
                  <button
                    className="settings-managed-main"
                    aria-label={`Edit saved recipe ${entry.name}`}
                    onClick={() => setRecipe(entry)}
                  >
                    <img
                      className="settings-managed-image"
                      src={entry.image}
                      alt=""
                    />
                    <span>
                      <strong>{entry.name}</strong>
                      <small>
                        {entry.minutes} minutes · {entry.servings} servings
                      </small>
                    </span>
                    <Pencil size={17} />
                  </button>
                  <button
                    className="icon-button danger"
                    aria-label={`Delete saved recipe ${entry.name}`}
                    onClick={() => setRemoveRecipe(entry)}
                  >
                    <Trash2 size={17} />
                  </button>
                </div>
              ))}
            </div>
            {!recipes.length && (
              <p className="quiet-label">No matching recipes.</p>
            )}
          </div>
        </section>
      )}
      {product && (
        <ProductEditor
          key={product === 'new' ? 'new' : product.id}
          product={product === 'new' ? undefined : product}
          onClose={() => setProduct(null)}
        />
      )}
      {recipe && (
        <RecipeEditor
          key={recipe === 'new' ? 'new' : recipe.id}
          recipe={recipe === 'new' ? undefined : recipe}
          onClose={() => setRecipe(null)}
        />
      )}
      <Modal
        open={!!removeRecipe}
        onOpenChange={(open) => {
          if (!open) setRemoveRecipe(null)
        }}
        title="Delete recipe?"
        description={`Delete ${removeRecipe?.name ?? 'this recipe'} for the whole family? It will also be removed from planned lunches. Purchase history is kept.`}
      >
        <div className="modal-actions">
          <button
            className="secondary-button"
            autoFocus
            onClick={() => setRemoveRecipe(null)}
          >
            Cancel
          </button>
          <button
            className="secondary-button danger"
            onClick={() => {
              if (removeRecipe)
                update((current) => deleteRecipe(current, removeRecipe.id))
              setRemoveRecipe(null)
            }}
          >
            Delete recipe
          </button>
        </div>
      </Modal>
    </>
  )
}

export function ProductEditor({
  product,
  onClose,
}: {
  product?: Product
  onClose: () => void
}) {
  const { state, groups, update } = useApp()
  const { insights } = useLearning()
  const [originalRate] = useState(
    product ? state.consumptionRates?.[product.id] : undefined,
  )
  const [consumptionRate, setConsumptionRate] = useState<
    ConsumptionRate | undefined
  >(originalRate)
  const [originalShelfLife] = useState(
    product ? state.shelfLifeDays?.[product.id] : undefined,
  )
  const builtInShelfLife = product
    ? defaultShelfLifeDays[product.id]
    : undefined
  const [shelfLife, setShelfLife] = useState<number | undefined>(() =>
    product ? shelfLifeDays(state, product.id) : undefined,
  )
  const habit = insights.habits.find((entry) => entry.productId === product?.id)
  const [name, setName] = useState(product?.name ?? '')
  const [group, setGroup] = useState(product?.category ?? groups[0])
  const [aliases, setAliases] = useState<string[]>(product?.aliases ?? [])
  const [description, setDescription] = useState(product?.description ?? '')
  const [aliasDraft, setAliasDraft] = useState('')
  const [image, setImage] = useState(product?.image ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmation, setConfirmation] = useState<'archive' | 'delete' | null>(
    null,
  )
  const archived = !!product && !!state.archivedProductIds?.includes(product.id)
  const custom = !!product && !catalog.some((entry) => entry.id === product.id)
  const used =
    !!product &&
    [...(state.recipeBook ?? []), ...state.customRecipes].some((recipe) =>
      recipe.ingredients.some(
        (ingredient) => ingredient.productId === product.id,
      ),
    )
  return (
    <>
      <Modal
        open
        onOpenChange={(open) => {
          if (!open && !busy) onClose()
        }}
        title={product ? 'Edit catalog item' : 'Create catalog item'}
        description="Changes are shared with your family. Existing shopping entries keep their quantity and notes."
      >
        <form
          className="editor-form"
          onSubmit={(event) => {
            event.preventDefault()
            if (busy) return
            if (
              getProducts(state).some(
                (entry) =>
                  entry.id !== product?.id &&
                  entry.name.toLowerCase() === name.trim().toLowerCase(),
              )
            ) {
              setError('An item with that name already exists.')
              return
            }
            const searchAliases = [
              ...new Set(
                [...aliases, ...aliasDraft.split(',')]
                  .map((value) => value.trim())
                  .filter(Boolean),
              ),
            ]
            if (
              searchAliases.length > 30 ||
              searchAliases.some((value) => value.length > 80)
            ) {
              setError('Use up to 30 aliases, each up to 80 characters.')
              return
            }
            const saved: Product = {
              ...product,
              id: product?.id ?? crypto.randomUUID(),
              name: name.trim(),
              category: group,
              icon: product?.icon ?? '🛒',
              aliases: searchAliases,
              image: image || undefined,
              description: description.trim() || undefined,
            }
            if (
              product &&
              JSON.stringify(originalRate ?? null) !==
                JSON.stringify(state.consumptionRates?.[product.id] ?? null)
            ) {
              setError(
                'The consumption rate changed on another device. Reopen this item to review it.',
              )
              return
            }
            if (
              product &&
              (originalShelfLife ?? null) !==
                (state.shelfLifeDays?.[product.id] ?? null)
            ) {
              setError(
                'The shelf life changed on another device. Reopen this item to review it.',
              )
              return
            }
            update((current) => {
              const rates = { ...current.consumptionRates }
              if (consumptionRate) rates[saved.id] = consumptionRate
              else delete rates[saved.id]
              // Store only differences from the built-in default; 0 turns it off.
              const shelf = { ...current.shelfLifeDays }
              if (shelfLife === builtInShelfLife) delete shelf[saved.id]
              else if (shelfLife === undefined) shelf[saved.id] = 0
              else shelf[saved.id] = shelfLife
              return approveAiAdded(
                {
                  ...saveProduct(current, saved),
                  consumptionRates: rates,
                  shelfLifeDays: shelf,
                },
                saved.id,
              )
            }, `Edit ${saved.name}`)
            onClose()
          }}
        >
          <label>
            Item name
            <input
              required
              maxLength={100}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label>
            Item group
            <select
              value={group}
              onChange={(event) => setGroup(event.target.value)}
            >
              {groups.map((entry) => (
                <option key={entry}>{entry}</option>
              ))}
            </select>
          </label>
          <label>
            Description
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Brand, size or a note (optional)"
              rows={2}
              maxLength={300}
            />
            <small>
              Filled in as the note when this goes on the shopping list.
            </small>
          </label>
          <AliasInput
            aliases={aliases}
            onChange={setAliases}
            draft={aliasDraft}
            onDraftChange={setAliasDraft}
          />
          <ConsumptionFields
            value={consumptionRate}
            onChange={setConsumptionRate}
            suggested={habit?.estimatedConsumption ?? undefined}
            purchases={habit?.purchases}
          />
          <ShelfLifeFields
            value={shelfLife}
            onChange={setShelfLife}
            name={name}
            typical={builtInShelfLife}
          />
          <ImageField
            kind="item"
            scope={product?.id ? `item:${product.id}` : ''}
            productId={product?.id}
            subject={name}
            value={image}
            onChange={setImage}
            onBusyChange={setBusy}
            onGenerated={(url) => {
              if (product)
                update((current) => ({
                  ...current,
                  productImages: {
                    ...current.productImages,
                    [product.id]: url,
                  },
                }))
            }}
          />
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button className="primary-button" disabled={busy || !name.trim()}>
            Save item
          </button>
        </form>
        {product && (
          <details className="settings-disclosure group-delete">
            <summary>
              {archived ? 'Restore or delete item' : 'Archive or delete item'}
            </summary>
            <p className="quiet-label">
              Archiving hides this item from autocomplete, restock suggestions
              and new AI suggestions. Recipes and existing shopping entries are
              kept.
            </p>
            <button
              className="secondary-button"
              disabled={busy}
              onClick={() => {
                if (archived) {
                  update((current) =>
                    archiveProduct(current, product.id, false),
                  )
                  onClose()
                } else setConfirmation('archive')
              }}
            >
              {archived ? 'Restore item' : 'Archive item'}
            </button>
            {custom && (
              <>
                <p className="quiet-label">
                  {used
                    ? 'This item is used in a recipe. Change its ingredients first to delete permanently, or archive it.'
                    : 'Permanent deletion also removes this item from the shopping list and estimated pantry.'}
                </p>
                <button
                  className="text-button danger"
                  disabled={busy || used}
                  onClick={() => setConfirmation('delete')}
                >
                  Delete item permanently
                </button>
              </>
            )}
          </details>
        )}
      </Modal>
      <Modal
        open={!!confirmation}
        onOpenChange={(open) => {
          if (!open) setConfirmation(null)
        }}
        title={
          confirmation === 'archive'
            ? 'Archive item?'
            : 'Delete item permanently?'
        }
        description={
          confirmation === 'archive'
            ? `Hide ${product?.name ?? 'this item'} from suggestions for the whole family? You can restore it here later. Existing lists and recipes are kept.`
            : `Permanently delete ${product?.name ?? 'this item'} from the catalog, shopping list and estimated pantry for the whole family?`
        }
      >
        <div className="modal-actions">
          <button
            className="secondary-button"
            autoFocus
            onClick={() => setConfirmation(null)}
          >
            Cancel
          </button>
          <button
            className="secondary-button danger"
            onClick={() => {
              if (!product) return
              try {
                update((current) =>
                  confirmation === 'archive'
                    ? archiveProduct(current, product.id, true)
                    : deleteProduct(current, product.id),
                )
                onClose()
              } catch (error) {
                setError(
                  error instanceof Error ? error.message : 'Please try again.',
                )
                setConfirmation(null)
              }
            }}
          >
            {confirmation === 'archive' ? 'Archive item' : 'Delete permanently'}
          </button>
        </div>
      </Modal>
    </>
  )
}

/** Loads the next page as the end of a long list approaches the viewport. */
function LoadMore({
  onVisible,
  children,
}: {
  onVisible: () => void
  children: ReactNode
}) {
  const sentinel = useRef<HTMLButtonElement>(null)
  const latest = useRef(onVisible)
  latest.current = onVisible
  useEffect(() => {
    const element = sentinel.current
    if (!element || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) latest.current()
      },
      { rootMargin: '600px 0px' },
    )
    observer.observe(element)
    return () => observer.disconnect()
  })
  // Still a button, so keyboard and assistive technology can load more too.
  return (
    <button
      ref={sentinel}
      className="text-button load-more"
      onClick={() => latest.current()}
    >
      {children}
    </button>
  )
}
