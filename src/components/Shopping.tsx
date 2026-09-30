import { useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { AnimatePresence, motion } from 'motion/react'
import {
  Check,
  Plus,
  Search,
  MapPin,
  ChevronDown,
  Pencil,
  ArrowRight,
  Clock3,
  ShoppingBasket,
  RotateCcw,
  Lightbulb,
} from 'lucide-react'
import { catalog, categories, productId, recipes } from '../lib/data'
import type { Category, Product, ShoppingItem } from '../lib/data'
import { useApp } from '../lib/state'
import { dateKey, mergeItem, restockSuggestions } from '../lib/shopping'
import { Eyebrow, EmptyState, Modal, SectionTitle } from './ui'
import { FoodIcon } from './FoodIcon'

const categoryColors: Partial<Record<Category, string>> = {
  'Fruit & vegetables': 'produce',
  'Dairy & eggs': 'dairy',
  'Bread & pastries': 'bread',
  'Grains & pasta': 'grains',
  'Meat & fish': 'fish',
}
export function Shopping() {
  const { state, update } = useApp()
  const [query, setQuery] = useState('')
  const [isFocused, setFocused] = useState(false)
  const [suggestionIndex, setSuggestionIndex] = useState(-1)
  const [addOpen, setAddOpen] = useState(false)
  const [edit, setEdit] = useState<ShoppingItem | null>(null)
  const [message, setMessage] = useState('')
  const messageTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const store =
    state.stores.find((s) => s.id === state.storeId) ?? state.stores[0]
  const active = state.items.filter((i) => !i.checked)
  const checked = state.items.filter((i) => i.checked)
  const products = [...catalog, ...state.customProducts]
  const suggestions = products
    .filter((p) => p.name.toLowerCase().includes(query.trim().toLowerCase()))
    .slice(0, 6)
  const canCreate = !products.some(
    (p) => p.name.toLowerCase() === query.trim().toLowerCase(),
  )
  const restock = restockSuggestions(state)
  const today =
    recipes.find((r) => r.id === state.plan[dateKey(new Date())]) ?? recipes[0]
  function announce(text: string) {
    setMessage(text)
    if (messageTimer.current) clearTimeout(messageTimer.current)
    messageTimer.current = setTimeout(() => setMessage(''), 3200)
  }
  function add(product: Product) {
    update((s) => ({ ...s, items: mergeItem(s.items, product) }))
    setQuery('')
    setFocused(false)
    input.current?.focus()
    announce(`${product.name} added to your list`)
  }
  function toggle(item: ShoppingItem) {
    update((s) => ({
      ...s,
      items: s.items.map((i) =>
        i.id === item.id ? { ...i, checked: !i.checked } : i,
      ),
      purchases: item.checked
        ? s.purchases
        : { ...s.purchases, [item.id]: new Date().toISOString() },
    }))
    announce(
      item.checked
        ? `${item.name} moved back to your list`
        : `${item.name} checked. Looking good!`,
    )
    if (!item.checked && typeof navigator !== 'undefined' && navigator.vibrate)
      navigator.vibrate(18)
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <Eyebrow>THE EVERYDAY, MADE EASIER</Eyebrow>
          <h1>
            Our shopping list<span className="heading-dot">.</span>
          </h1>
          <p>A happy kitchen starts with a good basket.</p>
        </div>
        <span className="list-count">
          <ShoppingBasket size={16} />
          {active.length} to pick up
        </span>
      </div>
      <div className="shopping-layout">
        <div className="shopping-main">
          <div className="store-bar">
            <div className="store-picker">
              <MapPin size={18} />
              <label className="sr-only" htmlFor="store">
                Shopping at
              </label>
              <select
                id="store"
                value={store.id}
                onChange={(e) =>
                  update((s) => ({ ...s, storeId: e.target.value }))
                }
              >
                {state.stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <ChevronDown size={15} />
            </div>
            <span className="store-order-label">
              In your store’s aisle order
            </span>
            <Link
              to="/settings"
              className="icon-button"
              aria-label="Configure stores"
            >
              <SettingsIcon />
            </Link>
          </div>
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
                      <FoodIcon value={p.icon} />
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
          <div className="shopping-caption">
            <span>
              <span className="green-dot" /> One tap to check. One less thing to
              remember.
            </span>
          </div>
          {active.length === 0 && (
            <EmptyState
              icon="🧺"
              title="Basket complete!"
              text="Everything’s checked. Time to head home and make something good."
            />
          )}
          <div className="shopping-groups">
            {store.order.map((category) => {
              const items = active.filter((i) => i.category === category)
              return (
                items.length > 0 && (
                  <section className="shopping-group" key={category}>
                    <SectionTitle title={category} count={items.length} />
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
                            className={`item-tile ${categoryColors[category] ?? 'other'}`}
                          >
                            <button
                              className="tile-check"
                              aria-label={`Check ${item.name}`}
                              onClick={() => toggle(item)}
                            >
                              <span className="tile-emoji" aria-hidden="true">
                                <FoodIcon value={item.icon} />
                              </span>
                              <strong>{item.name}</strong>
                              <span className="tile-quantity">
                                {item.quantity} {item.unit}
                              </span>
                              <span className="tile-note">
                                {item.note || ' '}
                              </span>
                              <span className="tile-check-indicator">
                                <Check size={15} />
                              </span>
                            </button>
                            <button
                              className="tile-edit"
                              aria-label={`Edit ${item.name}`}
                              onClick={() => setEdit(item)}
                            >
                              <Pencil size={12} />
                            </button>
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
                <span className="quiet-label">Tap to bring back</span>
              </SectionTitle>
              <div className="checked-items">
                <AnimatePresence initial={false}>
                  {checked.map((item) => (
                    <motion.button
                      layout
                      key={item.id}
                      initial={{ opacity: 0, y: -12 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className="checked-item"
                      aria-label={`Restore ${item.name}`}
                      onClick={() => toggle(item)}
                    >
                      <span>
                        <FoodIcon value={item.icon} />
                      </span>
                      <span>{item.name}</span>
                      <Check size={14} />
                    </motion.button>
                  ))}
                </AnimatePresence>
              </div>
            </section>
          )}
          <div className="list-footer">
            <span>Made for the little things that keep us going.</span>
            <span>
              <FoodIcon value="🌿" />
            </span>
          </div>
        </div>
        <aside className="shopping-aside">
          <div className="today-card">
            <Eyebrow>ON THE MENU TODAY</Eyebrow>
            <img src={today.image} alt={today.name} />
            <div>
              <h3>{today.name}</h3>
              <span>
                <Clock3 size={14} />
                {today.minutes} min <span className="separator">·</span>{' '}
                {today.servings} happy plates
              </span>
              <Link to="/week">
                See our week <ArrowRight size={16} />
              </Link>
            </div>
          </div>
          <div className="restock-card">
            <span className="restock-icon">
              <RotateCcw size={20} />
            </span>
            <h3>A little top-up?</h3>
            <p>Based on when you last picked up your everyday favorites.</p>
            {restock.length ? (
              restock.map((p) => (
                <button
                  className="restock-item"
                  key={p.id}
                  onClick={() => add(p)}
                >
                  <span>
                    <FoodIcon value={p.icon} />
                  </span>
                  <span>
                    <strong>{p.name}</strong>
                    <small>Usually every {p.interval} days</small>
                  </span>
                  <Plus size={16} />
                </button>
              ))
            ) : (
              <span className="restock-clear">
                <Check size={15} /> Your usuals are on the list.
              </span>
            )}
          </div>
          <div className="small-tip">
            <Lightbulb size={18} />
            <p>
              Planning lunch? Add a recipe’s ingredients in one tap. We’ll merge
              the duplicates.
            </p>
          </div>
        </aside>
      </div>
      <AnimatePresence>
        {message && (
          <motion.div
            role="status"
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
function SettingsIcon() {
  return (
    <span className="store-edit">
      <Pencil size={14} />
    </span>
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
  const { state, update } = useApp()
  const [name, setName] = useState(item?.name ?? initialName)
  const [category, setCategory] = useState<Category>(
    item?.category ?? 'Fruit & vegetables',
  )
  const [quantity, setQuantity] = useState(item?.quantity ?? 1)
  const [unit, setUnit] = useState(item?.unit ?? 'pc')
  const [note, setNote] = useState(item?.note ?? '')
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
              id: productId(name) || crypto.randomUUID(),
              name: name.trim(),
              category,
              icon: '🛒',
            }
          update((s) => ({
            ...s,
            customProducts:
              item || existing
                ? s.customProducts
                : [...s.customProducts, product],
            items: item
              ? s.items.map((i) =>
                  i.id === item.id
                    ? { ...i, category, quantity, unit, note }
                    : i,
                )
              : mergeItem(s.items, product, quantity, unit, note, true),
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
            {categories.map((c) => (
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
        <button className="primary-button" type="submit">
          <Check size={18} />
          {item ? 'Save details' : 'Add to shopping list'}
        </button>
        {item && (
          <button
            type="button"
            className="text-button danger"
            onClick={() => {
              update((s) => ({
                ...s,
                items: s.items.filter((i) => i.id !== item.id),
              }))
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
