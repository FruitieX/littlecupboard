import { useState } from 'react'
import { useLearning } from '../lib/learning'
import type { ConsumptionRate } from '../lib/api/ConsumptionRate'
import { ConsumptionFields, rateLabel } from './ConsumptionFields'
import { Pencil, Plus, Trash2 } from 'lucide-react'
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
  const { state, allRecipes, update } = useApp()
  const { insights } = useLearning()
  const [query, setQuery] = useState('')
  const [recipeQuery, setRecipeQuery] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [product, setProduct] = useState<Product | 'new' | null>(null)
  const [recipe, setRecipe] = useState<Recipe | 'new' | null>(null)
  const [removeRecipe, setRemoveRecipe] = useState<Recipe | null>(null)
  const [limit, setLimit] = useState(30)
  const products = getProducts(state)
    .filter(
      (entry) =>
        !!state.archivedProductIds?.includes(entry.id) === showArchived,
    )
    .filter((entry) =>
      [entry.name, entry.category, ...(entry.aliases ?? [])].some((value) =>
        value.toLowerCase().includes(query.toLowerCase()),
      ),
    )
    .sort((a, b) => a.name.localeCompare(b.name))
  const recipes = allRecipes.filter((entry) =>
    entry.name.toLowerCase().includes(recipeQuery.toLowerCase()),
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
              <button
                className="text-button"
                onClick={() => setLimit((current) => current + 30)}
              >
                Show more items ({products.length - limit})
              </button>
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
                  <button
                    className="icon-button"
                    aria-label={`Edit saved recipe ${entry.name}`}
                    onClick={() => setRecipe(entry)}
                  >
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

function ProductEditor({
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
  const habit = insights.habits.find((entry) => entry.productId === product?.id)
  const [name, setName] = useState(product?.name ?? '')
  const [group, setGroup] = useState(product?.category ?? groups[0])
  const [aliases, setAliases] = useState(product?.aliases?.join(', ') ?? '')
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
                aliases
                  .split(',')
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
            update((current) => {
              const rates = { ...current.consumptionRates }
              if (consumptionRate) rates[saved.id] = consumptionRate
              else delete rates[saved.id]
              return { ...saveProduct(current, saved), consumptionRates: rates }
            }, `Edit ${saved.name}`)
            onClose()
          }}
        >
          <label>
            Item name
            <input
              autoFocus
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
            Search aliases
            <input
              value={aliases}
              maxLength={2400}
              onChange={(event) => setAliases(event.target.value)}
              placeholder="Alternate names, separated by commas"
            />
          </label>
          <ConsumptionFields
            value={consumptionRate}
            onChange={setConsumptionRate}
            suggested={habit?.estimatedConsumption ?? undefined}
            purchases={habit?.purchases}
          />
          <ImageField
            kind="item"
            subject={name}
            value={image}
            onChange={setImage}
            onBusyChange={setBusy}
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
