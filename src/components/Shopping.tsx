import { useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Check, Plus, Search, CalendarDays } from 'lucide-react'
import { catalog, categories } from '../lib/data'
import type { Category, Product, ShoppingItem } from '../lib/data'
import { useApp } from '../lib/state'
import { useLearning } from '../lib/learning'
import { KitchenTools } from './KitchenTools'
import { EmptyState, Modal, SectionTitle } from './ui'
import { FoodIcon } from './FoodIcon'
import { ImageField } from './ImageField'
import { HoldButton } from './HoldButton'
import { StoreCombobox } from './StoreCombobox'
import { shoppingQuantity } from '../lib/meal-shopping'
import { cleanItem } from '../lib/sync'
import { useShoppingLayout } from '../lib/shopping-layout'

const categoryColors: Partial<Record<Category, string>> = {
  'Fruit & vegetables': 'produce',
  Fruits: 'produce',
  Vegetables: 'produce',
  'Milk & eggs': 'dairy',
  Cheese: 'dairy',
  Bread: 'bread',
  Pastries: 'bread',
  'Grain products': 'grains',
  Fish: 'fish',
  Meat: 'fish',
  'Dairy & eggs': 'dairy',
  'Bread & pastries': 'bread',
  'Grains & pasta': 'grains',
  'Meat & fish': 'fish',
}
export function Shopping() {
  const { state, update, action, shoppingItems, session } = useApp()
  const { groupByCategory } = useShoppingLayout(session.user.id)
  const { insights } = useLearning()
  const [query, setQuery] = useState('')
  const [isFocused, setFocused] = useState(false)
  const [suggestionIndex, setSuggestionIndex] = useState(-1)
  const [addOpen, setAddOpen] = useState(false)
  const [edit, setEdit] = useState<ShoppingItem | null>(null)
  const [message, setMessage] = useState('')
  const [showToast, setShowToast] = useState(false)
  const messageTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const store =
    state.stores.find((s) => s.id === state.storeId) ?? state.stores[0]
  const active = shoppingItems.filter((i) => !i.checked)
  const categoryOrder = [
    ...new Set([...store.order, ...active.map((item) => item.category)]),
  ]
  const sorted = categoryOrder.flatMap((category) =>
    active.filter((item) => item.category === category),
  )
  const sections = groupByCategory
    ? categoryOrder.map((category) => ({
        category,
        items: sorted.filter((item) => item.category === category),
      }))
    : [{ category: null, items: sorted }]
  const checked = shoppingItems.filter((i) => i.checked)
  const products = [...catalog, ...state.customProducts].map((p) => ({
    ...p,
    category: state.productGroups?.[p.id] ?? p.category,
  }))
  const suggestions = products
    .filter((p) =>
      [p.name, ...(p.aliases ?? [])].some((name) =>
        name.toLowerCase().includes(query.trim().toLowerCase()),
      ),
    )
    .slice(0, 6)
  const canCreate = !products.some(
    (p) => p.name.toLowerCase() === query.trim().toLowerCase(),
  )
  const restock = insights.restock.filter(
    (suggestion) => !active.some((item) => item.id === suggestion.product.id),
  )
  function announce(text: string, visible = true) {
    setMessage(text)
    setShowToast(visible)
    if (messageTimer.current) clearTimeout(messageTimer.current)
    messageTimer.current = setTimeout(() => setMessage(''), 3200)
  }
  function add(product: Product) {
    action({
      type: 'addItem',
      productId: product.id,
      quantity: 1,
      unit: 'pc',
      note: '',
      accumulate: false,
    })
    setQuery('')
    setFocused(false)
    input.current?.focus()
    announce(`${product.name} added to your list`)
  }
  function toggle(item: ShoppingItem) {
    action({
      type: 'checkItem',
      id: item.id,
      checked: !item.checked,
      expected: cleanItem(item),
    })
    announce(
      item.checked
        ? `${item.name} moved back to your list`
        : `${item.name} checked`,
      false,
    )
    if (!item.checked && typeof navigator !== 'undefined' && navigator.vibrate)
      navigator.vibrate(18)
  }
  return (
    <>
      <div className="shopping-heading">
        <h1>Shopping list</h1>
        <StoreCombobox />
      </div>
      <p id="entry-gesture-help" className="sr-only">
        Tap to check or restore. Hold to edit, or use right-click or Shift+F10.
      </p>
      <div className="shopping-layout">
        <div className="shopping-main">
          <div
            className="add-item-wrap"
            onBlur={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node))
                setFocused(false)
            }}
          >
            <form
              className="add-item"
              onSubmit={(e) => {
                e.preventDefault()
                const exact = products.find(
                  (p) => p.name.toLowerCase() === query.trim().toLowerCase(),
                )
                if (exact) add(exact)
                else setAddOpen(true)
              }}
            >
              <Search size={21} />
              <input
                ref={input}
                aria-label="Add a shopping item"
                role="combobox"
                aria-expanded={isFocused && !!query}
                aria-controls="product-suggestions"
                aria-activedescendant={
                  isFocused && suggestionIndex >= 0
                    ? `suggestion-${suggestionIndex}`
                    : undefined
                }
                autoComplete="off"
                placeholder="What do we need?"
                value={query}
                onFocus={() => setFocused(true)}
                onChange={(e) => {
                  setQuery(e.target.value)
                  setFocused(true)
                  setSuggestionIndex(-1)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setFocused(false)
                  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                    e.preventDefault()
                    setFocused(true)
                    setSuggestionIndex((i) =>
                      Math.max(
                        0,
                        Math.min(
                          suggestions.length - 1 + Number(canCreate),
                          i + (e.key === 'ArrowDown' ? 1 : -1),
                        ),
                      ),
                    )
                  }
                  if (
                    e.key === 'Enter' &&
                    isFocused &&
                    query &&
                    suggestionIndex >= 0
                  ) {
                    e.preventDefault()
                    if (suggestionIndex < suggestions.length)
                      add(suggestions[suggestionIndex])
                    else setAddOpen(true)
                  }
                }}
              />
              <button
                type="submit"
                className="add-submit"
                aria-label="Add item"
              >
                <Plus size={22} />
              </button>
            </form>
            {isFocused && query && (
              <div
                className="suggestions"
                id="product-suggestions"
                role="listbox"
                aria-label="Product suggestions"
                onMouseDown={(e) => e.preventDefault()}
              >
                {suggestions.map((p, index) => (
                  <button
                    key={p.id}
                    id={`suggestion-${index}`}
                    role="option"
                    aria-selected={suggestionIndex === index}
                    onClick={() => add(p)}
                  >
                    <span className="suggestion-icon">
                      <FoodIcon
                        image={state.productImages?.[p.id] || p.image}
                        value={p.icon}
                      />
                    </span>
                    <span>
                      <strong>{p.name}</strong>
                      <small>{p.category}</small>
                    </span>
                    <Plus size={18} />
                  </button>
                ))}
                {canCreate && (
                  <button
                    id={`suggestion-${suggestions.length}`}
                    role="option"
                    aria-selected={suggestionIndex === suggestions.length}
                    onClick={() => setAddOpen(true)}
                  >
                    <span className="suggestion-icon">
                      <FoodIcon value="✨" />
                    </span>
                    <span>
                      <strong>Create “{query.trim()}”</strong>
                      <small>Choose a group and add details</small>
                    </span>
                    <Plus size={18} />
                  </button>
                )}
              </div>
            )}
          </div>
          {active.length === 0 && (
            <EmptyState
              icon="🧺"
              title={
                checked.length ? 'Basket complete!' : 'Room for good things'
              }
              text={
                checked.length
                  ? 'Everything’s checked. Time to head home.'
                  : 'Add a few groceries or plan a lunch. We’ll gather the ingredients.'
              }
            />
          )}
          <div className="shopping-groups">
            {sections.map(({ category, items }) => {
              return (
                items.length > 0 && (
                  <section
                    className="shopping-group"
                    key={category ?? 'all'}
                    aria-label={category ?? 'Shopping items'}
                  >
                    {category && (
                      <SectionTitle title={category} count={items.length} />
                    )}
                    <motion.div layout className="item-grid">
                      <AnimatePresence mode="popLayout" initial={false}>
                        {items.map((item) => (
                          <motion.div
                            key={item.id}
                            layout
                            initial={{ opacity: 0, scale: 0.8 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.65, y: 16 }}
                            transition={{
                              type: 'spring',
                              stiffness: 400,
                              damping: 30,
                            }}
                            className={`item-tile ${categoryColors[item.category] ?? 'other'} ${item.autoAdded ? 'auto-added' : ''}`}
                          >
                            <HoldButton
                              className="tile-check"
                              aria-label={`Check ${item.name}`}
                              onPress={() => toggle(item)}
                              onHold={() => setEdit(item)}
                              aria-describedby="entry-gesture-help"
                            >
                              <span className="tile-emoji" aria-hidden="true">
                                <FoodIcon
                                  image={
                                    state.productImages?.[item.id] || item.image
                                  }
                                  value={item.icon}
                                />
                              </span>
                              <strong>{item.name}</strong>
                              <span className="tile-quantity">
                                {shoppingQuantity(item)}
                              </span>
                              <span className="tile-note">
                                {item.note || ' '}
                              </span>
                              {item.autoAdded && (
                                <span className="meal-plan-badge">
                                  <CalendarDays size={10} />
                                  Meal plan
                                </span>
                              )}
                            </HoldButton>
                          </motion.div>
                        ))}
                      </AnimatePresence>
                    </motion.div>
                  </section>
                )
              )
            })}
          </div>
          {checked.length > 0 && (
            <section className="recently-checked">
              <SectionTitle title="Recently checked" count={checked.length}>
                <button
                  className="text-button"
                  onClick={() => action({ type: 'finishTrip' })}
                >
                  Finish trip
                </button>
              </SectionTitle>
              <div className="checked-items">
                <AnimatePresence initial={false}>
                  {checked.map((item) => (
                    <motion.div
                      layout
                      key={item.id}
                      initial={{ opacity: 0, y: -12 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                    >
                      <HoldButton
                        className="checked-item"
                        aria-label={`Restore ${item.name}`}
                        onPress={() => toggle(item)}
                        onHold={() => setEdit(item)}
                        aria-describedby="entry-gesture-help"
                      >
                        <span>
                          <FoodIcon
                            image={state.productImages?.[item.id] || item.image}
                            value={item.icon}
                          />
                        </span>
                        <span>{item.name}</span>
                        <Check size={14} />
                      </HoldButton>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </section>
          )}
          {restock.length > 0 && (
            <details className="restock-disclosure">
              <summary>
                Restock suggestions{' '}
                <span className="count">{restock.length}</span>
              </summary>
              <div>
                {restock.map((suggestion) => (
                  <div key={suggestion.product.id}>
                    <button
                      className="restock-item"
                      onClick={() => {
                        action({
                          type: 'addItem',
                          productId: suggestion.product.id,
                          quantity: suggestion.quantity || 1,
                          unit: suggestion.unit || 'pc',
                          note: suggestion.note,
                          accumulate: false,
                        })
                        update((s) => ({
                          ...s,
                          suggestionFeedback: {
                            ...s.suggestionFeedback,
                            ['restock:' + suggestion.product.id]: {
                              status: 'accepted',
                              at: new Date().toISOString(),
                              until: null,
                            },
                          },
                        }))
                      }}
                    >
                      <span>
                        <FoodIcon value={suggestion.product.icon} />
                      </span>
                      <span>
                        <strong>{suggestion.product.name}</strong>
                        <small>{suggestion.reason}</small>
                      </span>
                      <Plus size={16} />
                    </button>
                    <div className="restock-actions">
                      {['Snooze 3 days', 'Dismiss'].map((label) => (
                        <button
                          className="text-button"
                          key={label}
                          onClick={() =>
                            update((s) => ({
                              ...s,
                              suggestionFeedback: {
                                ...s.suggestionFeedback,
                                ['restock:' + suggestion.product.id]: {
                                  status:
                                    label === 'Dismiss'
                                      ? 'dismissed'
                                      : 'snoozed',
                                  at: new Date().toISOString(),
                                  until:
                                    label === 'Dismiss'
                                      ? null
                                      : new Date(
                                          Date.now() + 3 * 86400000,
                                        ).toISOString(),
                                },
                              },
                            }))
                          }
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </details>
          )}
          <KitchenTools />
        </div>
      </div>
      <span className="sr-only" role="status">
        {message}
      </span>
      <AnimatePresence>
        {message && showToast && (
          <motion.div
            aria-hidden="true"
            className="toast"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
          >
            <Check size={17} />
            {message}
          </motion.div>
        )}
      </AnimatePresence>
      {addOpen && (
        <ItemEditor
          open
          onClose={() => {
            setAddOpen(false)
            setQuery('')
          }}
          initialName={query}
        />
      )}
      {edit && <ItemEditor open onClose={() => setEdit(null)} item={edit} />}
    </>
  )
}
function ItemEditor({
  open,
  onClose,
  initialName = '',
  item,
}: {
  open: boolean
  onClose: () => void
  initialName?: string
  item?: ShoppingItem
}) {
  const { state, update, action, groups } = useApp()
  const [name, setName] = useState(item?.name ?? initialName)
  const [category, setCategory] = useState<Category>(
    item?.category ?? groups[0],
  )
  const [quantity, setQuantity] = useState(item?.quantity ?? 1)
  const [unit, setUnit] = useState(item?.unit ?? 'pc')
  const [note, setNote] = useState(item?.note ?? '')
  const [pictureBusy, setPictureBusy] = useState(false)
  const [image, setImage] = useState(
    state.productImages?.[item?.id ?? ''] ?? item?.image ?? '',
  )
  const existing = [...catalog, ...state.customProducts].find(
    (p) => p.name.toLowerCase() === name.trim().toLowerCase(),
  )
  return (
    <Modal
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose()
      }}
      title={item ? 'The little details' : 'Something for the basket'}
      description="Brand, quantity, the exact kind—make it easy for whoever’s shopping."
    >
      <form
        className="editor-form"
        onSubmit={(e) => {
          e.preventDefault()
          const product: Product = item ??
            existing ?? {
              id: crypto.randomUUID(),
              name: name.trim(),
              category,
              icon: '🛒',
            }
          if (item)
            action({
              type: 'editItem',
              id: item.id,
              category,
              quantity,
              unit,
              note,
              expected: cleanItem(item),
            })
          else {
            if (!existing)
              update((s) => ({
                ...s,
                customProducts: [...s.customProducts, product],
              }))
            action({
              type: 'addItem',
              productId: product.id,
              quantity,
              unit,
              note,
              accumulate: true,
            })
          }
          update((s) => ({
            ...s,
            productImages: { ...s.productImages, [product.id]: image },
          }))
          onClose()
        }}
      >
        <label>
          Item name
          <input
            autoFocus
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            readOnly={!!item}
            placeholder="e.g. Whole wheat wraps"
            maxLength={80}
          />
        </label>
        <label>
          Group
          <select
            value={!item && existing ? existing.category : category}
            disabled={!!existing && !item}
            onChange={(e) => setCategory(e.target.value as Category)}
          >
            {(groups.length ? groups : categories).map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <div className="form-row">
          <label>
            Quantity
            <input
              type="number"
              min="0.01"
              step="any"
              required
              value={quantity}
              onChange={(e) => setQuantity(Number(e.target.value))}
            />
          </label>
          <label>
            Unit
            <input
              value={unit}
              required
              onChange={(e) => setUnit(e.target.value)}
              placeholder="g, L, pack…"
              maxLength={20}
            />
          </label>
        </div>
        <label>
          A little more detail
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Brand, color, size, or a note for the family…"
            rows={3}
            maxLength={300}
          />
        </label>
        {item?.mealNames?.length ? (
          <p className="planned-item-info">
            <CalendarDays size={15} />
            <span>
              Needed for {item.mealNames.join(', ')}. Quantities follow your
              plan. Changing the amount overrides it for these meals; removing
              this item skips it.
            </span>
          </p>
        ) : null}
        <ImageField
          kind="item"
          value={image}
          onChange={setImage}
          subject={name}
          onBusyChange={setPictureBusy}
        />
        <button className="primary-button" type="submit" disabled={pictureBusy}>
          <Check size={18} />
          {item ? 'Save details' : 'Add to shopping list'}
        </button>
        {item && (
          <button
            type="button"
            className="text-button danger"
            onClick={() => {
              action({ type: 'removeItem', id: item.id })
              onClose()
            }}
          >
            Remove from list
          </button>
        )}
      </form>
    </Modal>
  )
}
