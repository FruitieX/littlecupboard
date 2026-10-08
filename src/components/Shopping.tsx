import { NumberInput, QuantityStepper } from './NumberInput'
import { getProducts } from '../lib/catalog'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, MouseEvent } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import {
  Check,
  Plus,
  Search,
  CalendarDays,
  Sparkles,
  Clock3,
  MapPin,
  History,
  LoaderCircle,
  Camera,
} from 'lucide-react'
import { categories } from '../lib/data'
import type { AppState, Category, Product, ShoppingItem } from '../lib/data'
import { useApp } from '../lib/state'
import { useLearning } from '../lib/learning'
import type { Habit, Restock } from '../lib/learning'
import { Modal, SectionTitle } from './ui'
import { FoodIcon } from './FoodIcon'
import { ImageField } from './ImageField'
import { HoldButton } from './HoldButton'
import { StoreCombobox } from './StoreCombobox'
import { shoppingQuantity } from '../lib/meal-shopping'
import { cleanItem } from '../lib/sync'
import { useShoppingLayout } from '../lib/shopping-layout'
import { Confetti, type Burst } from './Confetti'
import { rankProducts } from '../lib/shopping'
import { post, uploadImage } from '../lib/http'
import type { ItemDetailsProposal } from '../lib/api/ItemDetailsProposal'

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
const quickUnits = ['pc', 'pack', 'g', 'kg', 'L']
// Long enough to read as a confirmation, short enough to never feel slow.
const CHECK_DELAY = 230

type TripSummary = {
  key: number
  count: number
  minutes: number | null
  store: string
  items: ShoppingItem[]
}

function productImage(state: AppState, product: Product) {
  return state.productImages?.[product.id] || product.image
}
function usualLabel(habit: Habit | undefined) {
  if (!habit?.quantity || !habit.unit) return ''
  return `Usually ${Number(habit.quantity.toFixed(2))} ${habit.unit}${
    habit.intervalDays ? ` · every ${habit.intervalDays} days` : ''
  }`
}
function daysLeftLabel(days: number | null | undefined) {
  if (days === null || days === undefined) return 'Due again'
  if (days < 0.5) return 'Probably out'
  if (days < 1.5) return '~1 day left'
  return `~${Math.round(days)} days left`
}
function center(event: MouseEvent<HTMLElement>) {
  const rect = event.currentTarget.getBoundingClientRect()
  // Keyboard activation reports 0,0; start from the middle instead.
  const keyboard = event.detail === 0
  return {
    x: keyboard ? rect.width / 2 : event.clientX - rect.left,
    y: keyboard ? rect.height / 2 : event.clientY - rect.top,
    pageX: rect.left + rect.width / 2,
    pageY: rect.top + rect.height / 2,
  }
}

export function Shopping() {
  const { state, update, action, shoppingItems, session } = useApp()
  const { groupByCategory } = useShoppingLayout(session.user.id)
  const { insights } = useLearning()
  const reduced = useReducedMotion() ?? false
  const [query, setQuery] = useState('')
  const [isFocused, setFocused] = useState(false)
  const [suggestionIndex, setSuggestionIndex] = useState(-1)
  const [addOpen, setAddOpen] = useState(false)
  const [edit, setEdit] = useState<ShoppingItem | null>(null)
  const [restockDetail, setRestockDetail] = useState<Restock | null>(null)
  const [message, setMessage] = useState('')
  const [showToast, setShowToast] = useState(false)
  const [burst, setBurst] = useState<Burst | null>(null)
  const [celebrating, setCelebrating] = useState(false)
  const [summary, setSummary] = useState<TripSummary | null>(null)
  const messageTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastCheck = useRef<{ x: number; y: number; at: number } | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const store =
    state.stores.find((s) => s.id === state.storeId) ?? state.stores[0]
  const active = useMemo(
    () => shoppingItems.filter((i) => !i.checked),
    [shoppingItems],
  )
  const checked = useMemo(
    () => shoppingItems.filter((i) => i.checked),
    [shoppingItems],
  )
  const sections = useMemo(() => {
    const categoryOrder = [
      ...new Set([...store.order, ...active.map((item) => item.category)]),
    ]
    const sorted = categoryOrder.flatMap((category) =>
      active.filter((item) => item.category === category),
    )
    return groupByCategory
      ? categoryOrder.map((category) => ({
          category,
          items: sorted.filter((item) => item.category === category),
        }))
      : [{ category: null, items: sorted }]
  }, [active, store.order, groupByCategory])
  const products = useMemo(
    () =>
      getProducts(state, false).map((p) => ({
        ...p,
        category: state.productGroups?.[p.id] ?? p.category,
      })),
    [state],
  )
  const habits = useMemo(
    () => new Map(insights.habits.map((habit) => [habit.productId, habit])),
    [insights.habits],
  )
  const onList = useMemo(() => new Set(active.map((i) => i.id)), [active])
  const trimmed = query.trim()
  const suggestions = trimmed
    ? rankProducts(
        products,
        trimmed,
        (id) => habits.get(id)?.purchases ?? 0,
      ).slice(0, 6)
    : insights.habits
        .filter((habit) => !onList.has(habit.productId))
        .sort((a, b) => b.purchases - a.purchases)
        .flatMap((habit) => products.filter((p) => p.id === habit.productId))
        .slice(0, 6)
  const canCreate =
    !!trimmed &&
    !products.some((p) => p.name.toLowerCase() === trimmed.toLowerCase())
  const optionCount = suggestions.length + Number(canCreate)
  const listOpen = isFocused && optionCount > 0
  const restock = insights.restock.filter(
    (suggestion) => !onList.has(suggestion.product.id),
  )

  function announce(text: string, visible = true) {
    setMessage(text)
    setShowToast(visible)
    if (messageTimer.current) clearTimeout(messageTimer.current)
    messageTimer.current = setTimeout(() => setMessage(''), 3200)
  }
  function add(product: Product) {
    const habit = habits.get(product.id)
    action({
      type: 'addItem',
      productId: product.id,
      quantity: habit?.quantity || 1,
      unit: habit?.unit || 'pc',
      note: habit?.preferredNote ?? '',
      accumulate: false,
    })
    setQuery('')
    setSuggestionIndex(-1)
    input.current?.focus()
    announce(`${product.name} added to your list`)
  }
  function addRestock(suggestion: Restock) {
    action({
      type: 'addItem',
      productId: suggestion.product.id,
      quantity: suggestion.quantity || 1,
      unit: suggestion.unit || 'pc',
      note: suggestion.note,
      accumulate: false,
    })
    feedback(suggestion, 'accepted')
    announce(`${suggestion.product.name} added to your list`)
  }
  function feedback(
    suggestion: Restock,
    status: 'accepted' | 'snoozed' | 'dismissed',
  ) {
    update((s) => ({
      ...s,
      suggestionFeedback: {
        ...s.suggestionFeedback,
        ['restock:' + suggestion.product.id]: {
          status,
          at: new Date().toISOString(),
          until:
            status === 'snoozed'
              ? new Date(Date.now() + 3 * 86400000).toISOString()
              : null,
        },
      },
    }))
  }
  function toggle(item: ShoppingItem, origin?: { x: number; y: number }) {
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
    if (!item.checked) {
      if (origin) lastCheck.current = { ...origin, at: Date.now() }
      if (typeof navigator !== 'undefined' && navigator.vibrate)
        navigator.vibrate(18)
    }
  }
  // Tiles are memoized; route their callbacks through a ref so a new
  // household snapshot does not re-render every tile.
  const toggleRef = useRef(toggle)
  toggleRef.current = toggle
  const onToggle = useCallback(
    (item: ShoppingItem, origin?: { x: number; y: number }) =>
      toggleRef.current(item, origin),
    [],
  )
  const onEdit = useCallback((item: ShoppingItem) => setEdit(item), [])

  // Celebrate when this device checks the last remaining item.
  const previousActive = useRef(active.length)
  useEffect(() => {
    const before = previousActive.current
    previousActive.current = active.length
    const recent = lastCheck.current
    if (
      before > 0 &&
      active.length === 0 &&
      recent &&
      Date.now() - recent.at < 2000
    ) {
      setBurst({ x: recent.x, y: recent.y, key: Date.now(), amount: 110 })
      setCelebrating(true)
    }
    if (active.length > 0) setCelebrating(false)
  }, [active.length])

  function finishTrip(event: MouseEvent<HTMLButtonElement>) {
    const times = checked
      .map((item) => Date.parse(state.purchases?.[item.id] ?? ''))
      .filter(Number.isFinite)
    const minutes = times.length
      ? Math.round((Date.now() - Math.min(...times)) / 60000)
      : null
    setSummary({
      key: Date.now(),
      count: checked.length,
      minutes:
        minutes !== null && minutes >= 1 && minutes <= 240 ? minutes : null,
      store: store.name,
      items: checked,
    })
    const rect = event.currentTarget.getBoundingClientRect()
    setBurst({
      x: rect.left + rect.width / 2,
      y: rect.top,
      key: Date.now(),
      amount: 70,
    })
    action({ type: 'finishTrip' })
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
                  (p) => p.name.toLowerCase() === trimmed.toLowerCase(),
                )
                if (exact) add(exact)
                // An empty box opens the dialog to type or snap a photo.
                else setAddOpen(true)
              }}
            >
              <Search size={21} />
              <input
                ref={input}
                aria-label="Add a shopping item"
                role="combobox"
                aria-expanded={listOpen}
                aria-controls="product-suggestions"
                aria-activedescendant={
                  listOpen && suggestionIndex >= 0
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
                          optionCount - 1,
                          i + (e.key === 'ArrowDown' ? 1 : -1),
                        ),
                      ),
                    )
                  }
                  if (e.key === 'Enter' && listOpen && suggestionIndex >= 0) {
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
            {listOpen && (
              <div
                className="suggestions"
                id="product-suggestions"
                role="listbox"
                aria-label={
                  trimmed ? 'Product suggestions' : 'Usually on our list'
                }
                onMouseDown={(e) => e.preventDefault()}
              >
                {!trimmed && (
                  <p className="suggestions-caption" aria-hidden="true">
                    <History size={13} /> Usually on our list
                  </p>
                )}
                {suggestions.map((p, index) => {
                  const habit = habits.get(p.id)
                  return (
                    <button
                      key={p.id}
                      id={`suggestion-${index}`}
                      role="option"
                      aria-selected={suggestionIndex === index}
                      onClick={() => add(p)}
                    >
                      <span className="suggestion-icon">
                        <FoodIcon
                          image={productImage(state, p)}
                          value={p.icon}
                          productId={p.id}
                          name={p.name}
                        />
                      </span>
                      <span>
                        <strong>{p.name}</strong>
                        <small>
                          {onList.has(p.id)
                            ? 'Already on the list'
                            : usualLabel(habit) || p.category}
                        </small>
                      </span>
                      <Plus size={18} />
                    </button>
                  )
                })}
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
                      <strong>Create “{trimmed}”</strong>
                      <small>Choose a group and add details</small>
                    </span>
                    <Plus size={18} />
                  </button>
                )}
              </div>
            )}
          </div>
          <AnimatePresence initial={false}>
            {restock.length > 0 && (
              <motion.section
                className="running-low"
                aria-label="Running low"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.25, ease: [0.2, 0.8, 0.2, 1] }}
              >
                <h2>
                  <Clock3 size={14} /> Running low
                  <span className="sr-only">
                    . Tap to add, hold for details.
                  </span>
                </h2>
                <div className="running-low-row">
                  <AnimatePresence initial={false} mode="popLayout">
                    {restock.map((suggestion) => (
                      <motion.div
                        key={suggestion.product.id}
                        layout="position"
                        initial={{ opacity: 0, scale: 0.85 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.6 }}
                        transition={{
                          type: 'spring',
                          stiffness: 520,
                          damping: 34,
                        }}
                      >
                        <HoldButton
                          className="restock-chip"
                          aria-label={`Add ${suggestion.product.name}, ${daysLeftLabel(suggestion.daysLeft)}`}
                          onPress={() => addRestock(suggestion)}
                          onHold={() => setRestockDetail(suggestion)}
                        >
                          <span className="restock-chip-icon">
                            <FoodIcon
                              value={suggestion.product.icon}
                              image={
                                state.productImages?.[suggestion.product.id] ||
                                suggestion.product.image
                              }
                              productId={suggestion.product.id}
                              name={suggestion.product.name}
                            />
                          </span>
                          <span>
                            <strong>{suggestion.product.name}</strong>
                            <small>{daysLeftLabel(suggestion.daysLeft)}</small>
                          </span>
                          <Plus size={16} />
                        </HoldButton>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
              </motion.section>
            )}
          </AnimatePresence>
          {active.length === 0 && (
            <div className={`basket-empty ${celebrating ? 'celebrate' : ''}`}>
              <span className="basket-empty-art" aria-hidden="true">
                <FoodIcon value="🧺" />
                {checked.length > 0 && (
                  <span className="basket-empty-check">
                    <Check size={18} strokeWidth={3} />
                  </span>
                )}
              </span>
              <h3>
                {checked.length ? 'Basket complete!' : 'Room for good things'}
              </h3>
              <p>
                {checked.length
                  ? 'Everything’s checked. Finish the trip when you’re done.'
                  : 'Add a few groceries or plan a lunch. We’ll gather the ingredients.'}
              </p>
            </div>
          )}
          <div className="shopping-groups">
            {sections.map(
              ({ category, items }) =>
                items.length > 0 && (
                  <section
                    className="shopping-group"
                    key={category ?? 'all'}
                    aria-label={category ?? 'Shopping items'}
                  >
                    {category && (
                      <SectionTitle title={category} count={items.length} />
                    )}
                    <div className="item-grid">
                      <AnimatePresence mode="popLayout" initial={false}>
                        {items.map((item) => (
                          <ItemTile
                            key={item.id}
                            item={item}
                            image={state.productImages?.[item.id] || item.image}
                            onToggle={onToggle}
                            onEdit={onEdit}
                            reduced={reduced}
                          />
                        ))}
                      </AnimatePresence>
                    </div>
                  </section>
                ),
            )}
          </div>
          <AnimatePresence initial={false}>
            {checked.length > 0 && (
              <motion.section
                className="recently-checked"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, transition: { duration: 0.2 } }}
              >
                <SectionTitle title="Recently checked" count={checked.length}>
                  <button className="finish-trip-button" onClick={finishTrip}>
                    <Check size={15} strokeWidth={2.6} />
                    Finish trip
                  </button>
                </SectionTitle>
                <div className="checked-items">
                  <AnimatePresence initial={false} mode="popLayout">
                    {checked.map((item) => (
                      <motion.div
                        layout="position"
                        key={item.id}
                        initial={{ opacity: 0, y: -10, scale: 0.9 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.8 }}
                        transition={{
                          type: 'spring',
                          stiffness: 500,
                          damping: 36,
                        }}
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
                              productId={item.id}
                              name={item.name}
                              image={
                                state.productImages?.[item.id] || item.image
                              }
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
              </motion.section>
            )}
          </AnimatePresence>
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
            initial={{ opacity: 0, y: 20, x: '-50%' }}
            animate={{ opacity: 1, y: 0, x: '-50%' }}
            exit={{ opacity: 0, y: 20, x: '-50%' }}
            transition={{ type: 'spring', stiffness: 500, damping: 36 }}
          >
            <Check size={17} />
            {message}
          </motion.div>
        )}
      </AnimatePresence>
      <Confetti burst={burst} />
      {summary && (
        <TripSummaryDialog
          summary={summary}
          nextTrip={insights.nextShoppingDay}
          onClose={() => setSummary(null)}
        />
      )}
      {restockDetail && (
        <Modal
          open
          onOpenChange={(open) => {
            if (!open) setRestockDetail(null)
          }}
          title={restockDetail.product.name}
          description={restockDetail.reason}
          className="compact-modal"
        >
          <div className="restock-detail-actions">
            <button
              className="primary-button"
              onClick={() => {
                addRestock(restockDetail)
                setRestockDetail(null)
              }}
            >
              <Plus size={18} /> Add to list
            </button>
            <button
              className="secondary-button"
              onClick={() => {
                feedback(restockDetail, 'snoozed')
                setRestockDetail(null)
              }}
            >
              Snooze 3 days
            </button>
            <button
              className="text-button"
              onClick={() => {
                feedback(restockDetail, 'dismissed')
                setRestockDetail(null)
              }}
            >
              Dismiss until next purchase
            </button>
          </div>
        </Modal>
      )}
      {addOpen && (
        <ItemEditor
          open
          onClose={() => {
            setAddOpen(false)
            setQuery('')
          }}
          initialName={trimmed}
        />
      )}
      {edit && <ItemEditor open onClose={() => setEdit(null)} item={edit} />}
    </>
  )
}

const ItemTile = memo(function ItemTile({
  item,
  image,
  onToggle,
  onEdit,
  reduced,
}: {
  item: ShoppingItem
  image?: string
  onToggle: (item: ShoppingItem, origin?: { x: number; y: number }) => void
  onEdit: (item: ShoppingItem) => void
  reduced: boolean
}) {
  const [tap, setTap] = useState<{ x: number; y: number } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )
  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, scale: 0.85 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{
        opacity: 0,
        scale: 0.6,
        transition: { duration: 0.18, ease: [0.4, 0, 1, 1] },
      }}
      transition={{ type: 'spring', stiffness: 520, damping: 38, mass: 0.8 }}
      className={`item-tile ${categoryColors[item.category] ?? 'other'} ${item.autoAdded ? 'auto-added' : ''} ${tap ? 'is-checking' : ''}`}
      style={
        tap
          ? ({
              '--tap-x': `${tap.x}px`,
              '--tap-y': `${tap.y}px`,
            } as CSSProperties)
          : undefined
      }
    >
      <HoldButton
        className="tile-check"
        aria-label={`Check ${item.name}`}
        onPress={(event) => {
          if (timer.current) return
          const point = center(event)
          const origin = { x: point.pageX, y: point.pageY }
          if (reduced) {
            onToggle(item, origin)
            return
          }
          setTap({ x: point.x, y: point.y })
          timer.current = setTimeout(() => {
            timer.current = null
            setTap(null)
            onToggle(item, origin)
          }, CHECK_DELAY)
        }}
        onHold={() => onEdit(item)}
        aria-describedby="entry-gesture-help"
      >
        <span className="tile-emoji" aria-hidden="true">
          <FoodIcon
            productId={item.id}
            name={item.name}
            image={image}
            value={item.icon}
          />
        </span>
        <strong>{item.name}</strong>
        <span className="tile-quantity">{shoppingQuantity(item)}</span>
        {item.note && <span className="tile-note">{item.note}</span>}
        {item.autoAdded && (
          <span className="meal-plan-badge">
            <CalendarDays size={10} />
            Meal plan
          </span>
        )}
        <span className="tile-burst" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M5 12.5l4.2 4.2L19 7" />
          </svg>
        </span>
      </HoldButton>
    </motion.div>
  )
})

function TripSummaryDialog({
  summary,
  nextTrip,
  onClose,
}: {
  summary: TripSummary
  nextTrip: string | null
  onClose: () => void
}) {
  const next = nextTrip
    ? new Date(`${nextTrip}T12:00:00`).toLocaleDateString('en-GB', {
        weekday: 'long',
      })
    : null
  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title="Trip complete!"
      description="Everything checked is now counted as bought, and the list is ready for next time."
      className="trip-summary"
    >
      <div className="trip-summary-art" aria-hidden="true">
        <svg viewBox="0 0 52 52" className="trip-summary-check">
          <circle cx="26" cy="26" r="24" />
          <path d="M15 27l7 7 15-16" />
        </svg>
        <div className="trip-summary-items">
          {summary.items.slice(0, 8).map((item, index, shown) => (
            <span
              key={item.id}
              style={
                {
                  '--i': index,
                  '--angle': `${(index - (shown.length - 1) / 2) * Math.min(26, 168 / Math.max(shown.length - 1, 1))}deg`,
                } as CSSProperties
              }
            >
              <FoodIcon
                productId={item.id}
                name={item.name}
                image={item.image}
                value={item.icon}
              />
            </span>
          ))}
        </div>
      </div>
      <dl className="trip-summary-stats">
        <div>
          <dt>Items</dt>
          <dd>{summary.count}</dd>
        </div>
        {summary.minutes !== null && (
          <div>
            <dt>Minutes</dt>
            <dd>{summary.minutes}</dd>
          </div>
        )}
        <div>
          <dt>
            <MapPin size={12} /> Shop
          </dt>
          <dd className="trip-summary-store">{summary.store}</dd>
        </div>
      </dl>
      {next && (
        <p className="trip-summary-next">
          <Sparkles size={15} /> We’ll keep an eye on what runs low before{' '}
          {next}.
        </p>
      )}
      <button className="primary-button" onClick={onClose} autoFocus>
        <Check size={18} /> Done
      </button>
    </Modal>
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
  const { state, update, action, groups, session, status } = useApp()
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
  // An existing item recognized from a photo; otherwise match by name.
  const [matchedId, setMatchedId] = useState<string | null>(null)
  const products = getProducts(state)
  const existing =
    (matchedId && products.find((p) => p.id === matchedId)) ||
    products.find((p) => p.name.toLowerCase() === name.trim().toLowerCase())
  const multipleAmounts = (item?.amounts?.length ?? 0) > 1
  const [moreOpen, setMoreOpen] = useState(false)
  // Fields the family set themselves; AI suggestions never replace them.
  const touched = useRef(new Set<string>())
  const touch =
    <T,>(field: string, set: (value: T) => void) =>
    (value: T) => {
      touched.current.add(field)
      set(value)
    }
  const [filling, setFilling] = useState(false)
  const [photos, setPhotos] = useState<string[]>([])
  const [uploading, setUploading] = useState(false)
  const [suggestedShelfLife, setSuggestedShelfLife] = useState<number | null>(
    null,
  )
  const [fillError, setFillError] = useState('')
  const [iconRequest, setIconRequest] = useState<{
    key: number
    subject: string
  } | null>(null)
  async function fillWithAi(images = photos) {
    setFilling(true)
    setFillError('')
    const known = touched.current
    try {
      const details = await post<ItemDetailsProposal>('/ai/item-details', {
        name: known.has('name') || !images.length ? name.trim() : '',
        images,
        quantity: known.has('quantity') ? quantity : null,
        unit: known.has('unit') ? unit : null,
        note: known.has('note') && note.trim() ? note : null,
        group: existing
          ? existing.category
          : known.has('group')
            ? category
            : null,
      })
      const match = details.productId
        ? products.find((p) => p.id === details.productId)
        : undefined
      setMatchedId(match?.id ?? null)
      setName(match?.name ?? details.name)
      if (!known.has('quantity')) setQuantity(details.quantity)
      if (!known.has('unit')) setUnit(details.unit)
      if (!known.has('note') || !note.trim()) setNote(details.note)
      if (!match && !known.has('group')) setCategory(details.group)
      setSuggestedShelfLife(match ? null : (details.shelfLifeDays ?? null))
      // New items get an icon automatically; existing ones keep theirs.
      if (match) setImage(state.productImages?.[match.id] ?? '')
      else if (session.imageEnabled && !image)
        setIconRequest({
          key: Date.now(),
          subject: `${details.name}: ${details.iconDescription}`,
        })
    } catch (error) {
      setFillError(
        error instanceof TypeError
          ? 'Cannot reach the server. Check your connection and try again.'
          : error instanceof Error
            ? error.message
            : 'Please try again.',
      )
    } finally {
      setFilling(false)
    }
  }
  async function addPhoto(file: File) {
    setUploading(true)
    setFillError('')
    try {
      // Kept at full resolution with the item for later use.
      const url = await uploadImage(file, true)
      const next = [...photos, url].slice(-4)
      setPhotos(next)
      setUploading(false)
      if (session.aiEnabled) await fillWithAi(next)
    } catch (error) {
      setFillError(error instanceof Error ? error.message : 'Please try again.')
    } finally {
      setUploading(false)
    }
  }
  // Show a picture that is still generating (for example after reopening).
  useEffect(() => {
    if (pictureBusy) setMoreOpen(true)
  }, [pictureBusy])
  const busy = filling || uploading
  return (
    <Modal
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose()
      }}
      title={item ? item.name : 'Something for the basket'}
      description={
        item
          ? 'Adjust the amount or leave a note for whoever’s shopping.'
          : 'Type a name or snap a photo.'
      }
      className="item-editor"
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
                ...(suggestedShelfLife
                  ? {
                      shelfLifeDays: {
                        ...s.shelfLifeDays,
                        [product.id]: suggestedShelfLife,
                      },
                    }
                  : {}),
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
          if (
            image !== (state.productImages?.[product.id] ?? '') ||
            photos.length
          )
            update((s) => ({
              ...s,
              productImages:
                image !== (s.productImages?.[product.id] ?? '')
                  ? { ...s.productImages, [product.id]: image }
                  : s.productImages,
              itemPhotos: photos.length
                ? {
                    ...s.itemPhotos,
                    [product.id]: [
                      ...(s.itemPhotos?.[product.id] ?? []),
                      ...photos,
                    ].slice(-12),
                  }
                : s.itemPhotos,
            }))
          onClose()
        }}
      >
        {!item && (
          <div className="item-name-row">
            <label>
              <span className="sr-only">Item name</span>
              <input
                aria-label="Item name"
                autoFocus={!!initialName}
                required
                value={name}
                onChange={(e) => {
                  setMatchedId(null)
                  touch('name', setName)(e.target.value)
                }}
                placeholder="What do we need?"
                maxLength={80}
              />
            </label>
            <label
              className={`photo-button ${busy ? 'busy' : ''}`}
              title="Take or choose a photo"
            >
              {uploading ? (
                <LoaderCircle size={20} className="spin" />
              ) : (
                <Camera size={20} />
              )}
              <span className="sr-only">Add from a photo</span>
              <input
                aria-label="Add from a photo"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                disabled={busy || status === 'offline'}
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) void addPhoto(file)
                  event.target.value = ''
                }}
              />
            </label>
          </div>
        )}
        {!item && (photos.length > 0 || session.aiEnabled) && (
          <div className="item-assist">
            {photos.map((url) => (
              <img key={url} className="item-photo" src={url} alt="" />
            ))}
            {session.aiEnabled && (
              <button
                type="button"
                className="ai-fill-button"
                disabled={
                  (!name.trim() && !photos.length) ||
                  busy ||
                  status === 'offline'
                }
                title="Suggests the amount, unit, note and group, and draws an icon. Anything you chose is kept."
                onClick={() => void fillWithAi()}
              >
                {filling ? (
                  <LoaderCircle size={16} className="spin" />
                ) : (
                  <Sparkles size={16} />
                )}
                {filling
                  ? photos.length
                    ? 'Looking at the photo…'
                    : 'Filling in…'
                  : 'Fill in with AI'}
              </button>
            )}
            {existing && matchedId && (
              <span className="item-match">
                <Check size={14} /> Already in your items
              </span>
            )}
          </div>
        )}
        {fillError && (
          <p className="form-error" role="alert">
            {fillError}
          </p>
        )}
        <div className="amount-row">
          {multipleAmounts ? (
            <NumberInput
              aria-label="Quantity"
              min="0.01"
              step="any"
              required
              value={quantity}
              onValueChange={touch('quantity', setQuantity)}
            />
          ) : (
            <QuantityStepper
              label="Quantity"
              unit={unit}
              required
              value={quantity}
              onValueChange={touch('quantity', setQuantity)}
            />
          )}
          <input
            className="unit-input"
            aria-label="Unit"
            value={unit}
            required
            onChange={(e) => touch('unit', setUnit)(e.target.value)}
            placeholder="unit"
            maxLength={20}
          />
        </div>
        <div className="unit-chips" role="group" aria-label="Common units">
          {quickUnits.map((option) => (
            <button
              key={option}
              type="button"
              className={unit === option ? 'selected' : ''}
              aria-pressed={unit === option}
              onClick={() => touch('unit', setUnit)(option)}
            >
              {option}
            </button>
          ))}
        </div>
        <textarea
          aria-label="A little more detail"
          value={note}
          onChange={(e) => touch('note', setNote)(e.target.value)}
          placeholder="Brand, size or a note (optional)"
          rows={2}
          maxLength={300}
        />
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
        <details
          className="editor-more"
          open={moreOpen}
          onToggle={(event) => setMoreOpen(event.currentTarget.open)}
        >
          <summary>
            Group & picture
            <span className="editor-more-summary">
              {existing && !item ? existing.category : category}
            </span>
          </summary>
          <div className="editor-more-body">
            <label>
              Group
              <select
                value={!item && existing ? existing.category : category}
                disabled={!!existing && !item}
                onChange={(e) =>
                  touch('group', setCategory)(e.target.value as Category)
                }
              >
                {(groups.length ? groups : categories).map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <ImageField
              kind="item"
              scope={
                item?.id || existing?.id
                  ? `item:${item?.id ?? existing?.id}`
                  : ''
              }
              productId={item?.id ?? existing?.id}
              value={image}
              onChange={setImage}
              subject={name}
              onBusyChange={setPictureBusy}
              generateRequest={iconRequest}
            />
          </div>
        </details>
        <div className="editor-actions">
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
          <button
            className="primary-button"
            type="submit"
            disabled={pictureBusy || busy}
          >
            <Check size={18} />
            {item ? 'Save details' : 'Add to shopping list'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
