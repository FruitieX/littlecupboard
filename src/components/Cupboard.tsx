import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  BellOff,
  Check,
  ChevronDown,
  Clock3,
  History,
  PackageOpen,
  Plus,
  RefreshCw,
  Replace,
  SlidersHorizontal,
  Settings2,
  Sparkles,
  Trash2,
  TriangleAlert,
} from 'lucide-react'
import { QuantityStepper } from './NumberInput'
import { deleteProduct, getProducts } from '../lib/catalog'
import { useApp } from '../lib/state'
import { useHistory, useLearning, useStats } from '../lib/learning'
import type { Habit } from '../lib/learning'
import { pantryTotal } from '../lib/meal-shopping'
import type { Amount, Product } from '../lib/data'
import type { StockEstimate } from '../lib/api/StockEstimate'
import type { HouseholdStats } from '../lib/api/HouseholdStats'
import { Modal, SectionTitle } from './ui'
import { FoodIcon } from './FoodIcon'
import { PantryEditor, pantryEdit, type PantryEdit } from './PantryEditor'
import { ProductEditor } from './LibrarySettings'
import { PhotoButton } from './PhotoButton'
import { approveAiAdded } from '../lib/ai-added'
import { photoError, queuePhotoJob } from './PhotoCapture'
import { ItemSearch } from './ItemSearch'
import { ItemEditor } from './Shopping'
import { ActionMenu } from './ActionMenu'
import {
  dismissWarning,
  movePantryEntry,
  stockWarning,
  warningDismissed,
} from '../lib/pantry'

type Tab = 'stock' | 'trends' | 'history'
const tabs: { id: Tab; label: string }[] = [
  { id: 'stock', label: 'At home' },
  { id: 'trends', label: 'Trends' },
  { id: 'history', label: 'History' },
]

/** Friendlier units for display and editing: 1500 ml → 1.5 L. */
export function displayAmount(amount: Amount): Amount {
  const unit = amount.unit
  if (unit === 'g' && amount.quantity >= 1000)
    return { quantity: round(amount.quantity / 1000, 2), unit: 'kg' }
  if (unit === 'ml' && amount.quantity >= 1000)
    return { quantity: round(amount.quantity / 1000, 2), unit: 'L' }
  if (unit === 'g' || unit === 'ml')
    return { quantity: Math.round(amount.quantity), unit }
  return { quantity: round(amount.quantity, 1), unit }
}
function round(value: number, digits: number) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}
function amountsLabel(amounts: Amount[], estimated = false) {
  return (
    amounts
      .map(displayAmount)
      .map((a) => {
        if (!estimated) return `${a.quantity} ${a.unit}`
        // Estimates are approximate; avoid "0.9 eggs".
        if (a.unit === 'pc')
          return a.quantity < 1
            ? 'less than 1 pc'
            : `~${Math.round(a.quantity)} pc`
        return `~${a.quantity} ${a.unit}`
      })
      .join(' + ') || 'None left'
  )
}
function daysLabel(days: number) {
  if (days < 0.5) return 'probably used up'
  if (days < 1.5) return 'about a day left'
  if (days < 14) return `about ${Math.round(days)} days left`
  return `about ${Math.round(days / 7)} weeks left`
}

function useWithinLabel(
  estimate: StockEstimate | undefined,
  expiresAt: string | null,
) {
  const today = new Date().toISOString().slice(0, 10)
  if (expiresAt && expiresAt < today) return `use by ${expiresAt} passed`
  const days = estimate?.useWithinDays
  if (days !== null && days !== undefined) {
    if (days < 0) return 'probably past its best'
    if (days < 1) return 'use today'
    if (days < 1.5) return 'use within a day'
    if (days <= 4) return `use within ~${Math.round(days)} days`
  }
  return expiresAt ? `use by ${expiresAt}` : null
}

export function Cupboard() {
  const [tab, setTab] = useState<Tab>('stock')
  return (
    <>
      <div className="page-heading cupboard-heading">
        <div>
          <h1>
            Our cupboard<span className="heading-dot">.</span>
          </h1>
          <p className="page-lede">
            What’s likely at home, learned from what we buy and confirm.
          </p>
        </div>
      </div>
      <div className="segmented" role="tablist" aria-label="Cupboard views">
        {tabs.map(({ id, label }) => (
          <button
            key={id}
            role="tab"
            id={`cupboard-tab-${id}`}
            aria-selected={tab === id}
            aria-controls={`cupboard-panel-${id}`}
            className={tab === id ? 'active' : ''}
            onClick={() => setTab(id)}
          >
            {tab === id && (
              <motion.span
                layoutId="segmented-indicator"
                className="segmented-indicator"
                transition={{ type: 'spring', stiffness: 500, damping: 40 }}
              />
            )}
            <span>{label}</span>
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`cupboard-panel-${tab}`}
        aria-labelledby={`cupboard-tab-${tab}`}
        className="cupboard-panel"
      >
        {tab === 'stock' && <StockView />}
        {tab === 'trends' && <TrendsView />}
        {tab === 'history' && <HistoryView />}
      </div>
    </>
  )
}

function StockView() {
  const { state, update, action, session, status } = useApp()
  const [snapping, setSnapping] = useState(false)
  const [message, setMessage] = useState('')
  async function snap(file: File) {
    setSnapping(true)
    setMessage('')
    try {
      await queuePhotoJob(file, 'pantry')
      setMessage(
        'Got it — we’ll add it to the cupboard in the background. It’s marked AI until someone checks it.',
      )
    } catch (error) {
      setMessage(photoError(error))
    } finally {
      setSnapping(false)
    }
  }
  useEffect(() => {
    if (!message) return
    const timer = setTimeout(() => setMessage(''), 6000)
    return () => clearTimeout(timer)
  }, [message])
  const { insights } = useLearning()
  const [open, setOpen] = useState<string | null>(null)
  const [reveal, setReveal] = useState<string | null>(null)
  const [editing, setEditing] = useState<PantryEdit | null>(null)
  const [editingItem, setEditingItem] = useState<string | null>(null)
  const [creating, setCreating] = useState<string | null>(null)
  const [moving, setMoving] = useState<string | null>(null)
  const products = useMemo(() => getProducts(state), [state])
  const searchable = useMemo(() => getProducts(state, false), [state])
  const byId = useMemo(
    () => new Map(products.map((product) => [product.id, product])),
    [products],
  )
  const habits = useMemo(
    () => new Map(insights.habits.map((habit) => [habit.productId, habit])),
    [insights.habits],
  )
  const estimates = useMemo(
    () => new Map(insights.stock.map((entry) => [entry.productId, entry])),
    [insights.stock],
  )
  const onList = new Set(
    state.items.filter((item) => !item.checked).map((item) => item.id),
  )
  // Open and scroll to an item someone just added or picked.
  function show(id: string) {
    setOpen(id)
    setReveal(id)
  }
  useEffect(() => {
    if (!reveal) return
    const frame = requestAnimationFrame(() => {
      document
        .getElementById(`stock-row-${reveal}`)
        ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      setReveal(null)
    })
    return () => cancelAnimationFrame(frame)
  }, [reveal, state.pantry])
  function pick(product: Product, note?: string) {
    if (state.pantry?.[product.id]) {
      setMessage(`${product.name} is already here — check the amount.`)
      show(product.id)
      return
    }
    const habit = habits.get(product.id)
    action({
      type: 'observePantry',
      productId: product.id,
      quantity: habit?.quantity || 1,
      unit: habit?.unit || 'pc',
      note: note ?? '',
      expiresAt: null,
    })
    setMessage(
      `${product.name} added to the cupboard. Adjust the amount below.`,
    )
    show(product.id)
  }
  // Keep every pantry entry visible, even before the server's projection
  // for a freshly added item arrives.
  const rows = Object.keys(state.pantry ?? {})
    .map((id) => {
      const estimate = estimates.get(id)
      const warning = stockWarning(estimate)
      const dismissed = !!warning && warningDismissed(state, id, warning)
      return {
        id,
        product: byId.get(id),
        estimate,
        warning: dismissed ? null : warning,
        dismissed,
      }
    })
    .sort(
      (a, b) =>
        (a.estimate?.daysLeft ?? Number.MAX_VALUE) -
          (b.estimate?.daysLeft ?? Number.MAX_VALUE) ||
        (a.product?.name ?? a.id).localeCompare(b.product?.name ?? b.id),
    )
  const groups = [
    {
      title: 'Use soon',
      rows: rows.filter((row) => row.warning === 'use-soon'),
    },
    {
      title: 'Running low',
      rows: rows.filter((row) => row.warning === 'restock'),
    },
    {
      title: 'Well stocked',
      rows: rows.filter((row) => row.estimate?.status === 'plenty'),
    },
    {
      title: 'Not tracked yet',
      hint: 'Set a consumption rate or buy these a few times and we’ll estimate how long they last.',
      rows: rows.filter(
        (row) =>
          !row.warning &&
          !row.dismissed &&
          (row.estimate?.status ?? 'unknown') === 'unknown',
      ),
    },
    {
      title: 'Warnings dismissed',
      hint: 'Shown again after the next purchase or confirmed amount.',
      rows: rows.filter((row) => row.dismissed),
    },
  ]
  const pantryEditing = editing && state.pantry?.[editing.id] ? editing : null
  const editedProduct = editingItem ? byId.get(editingItem) : undefined
  const movedProduct = moving ? byId.get(moving) : undefined
  return (
    <>
      <ItemSearch
        id="pantry"
        className="cupboard-search"
        state={state}
        products={searchable}
        label="Add something we have"
        submitLabel="Add to cupboard"
        placeholder="What do we have?"
        score={(id) => habits.get(id)?.purchases ?? 0}
        describe={(p) =>
          state.pantry?.[p.id]
            ? `Already here · ${amountsLabel(pantryTotal(state, p.id))}`
            : p.category
        }
        createHint="Add it to our items and the cupboard"
        onPick={pick}
        onCreate={(name) => setCreating(name)}
      >
        {session.aiEnabled && (
          <PhotoButton
            label="Snap what we have"
            busy={snapping}
            disabled={status === 'offline'}
            onFile={(file) => void snap(file)}
          />
        )}
      </ItemSearch>
      {message && (
        <p className="snap-message" role="status">
          {message}
        </p>
      )}
      {!rows.length && (
        <div className="cupboard-empty">
          <FoodIcon value="🫙" />
          <h3>Nothing recorded yet</h3>
          <p>
            Checked groceries appear here automatically. Confirm a few staples
            so we can tell when they run low.
          </p>
        </div>
      )}
      {groups.map(
        (group) =>
          group.rows.length > 0 && (
            <section key={group.title} className="stock-group">
              <SectionTitle title={group.title} count={group.rows.length} />
              {group.hint && <p className="quiet-label">{group.hint}</p>}
              <div className="stock-list">
                {group.rows.map(({ id, product, estimate, warning }) => (
                  <StockRow
                    key={id}
                    id={id}
                    product={product}
                    estimate={estimate}
                    warning={warning}
                    habit={habits.get(id)}
                    total={pantryTotal(state, id)}
                    entry={state.pantry![id]}
                    onList={onList.has(id)}
                    open={open === id}
                    onToggle={() => setOpen(open === id ? null : id)}
                    onMore={() =>
                      setEditing(pantryEdit(state, id, product?.name ?? id))
                    }
                    onSettings={() => setEditingItem(id)}
                    onMove={() => setMoving(id)}
                    aiAdded={!!state.aiAdded?.[id]}
                    onApprove={() =>
                      update(
                        (s) => approveAiAdded(s, id),
                        `Approve ${product?.name ?? id}`,
                      )
                    }
                    onDismiss={() => {
                      if (!warning) return
                      update(
                        (s) => dismissWarning(s, id, warning),
                        `Dismiss warning for ${product?.name ?? id}`,
                      )
                      setMessage(
                        `Hidden until ${product?.name ?? id} is bought or confirmed again.`,
                      )
                    }}
                    shelfLife={state.shelfLifeDays?.[id]}
                    onUsedUp={() => {
                      const unit = pantryTotal(state, id)[0]?.unit ?? 'pc'
                      action({
                        type: 'observePantry',
                        productId: id,
                        quantity: 0,
                        unit,
                        amounts: [{ quantity: 0, unit }],
                        note: state.pantry![id].note,
                        expiresAt: null,
                        expected: structuredClone(state.pantry![id]),
                      })
                      setMessage(`${product?.name ?? id} marked as used up.`)
                    }}
                    onRemove={() => {
                      setOpen(null)
                      update(
                        (s) => {
                          const pantry = { ...s.pantry }
                          delete pantry[id]
                          return { ...s, pantry }
                        },
                        `Remove ${product?.name ?? id} from pantry`,
                      )
                      setMessage(
                        `${product?.name ?? id} removed from the cupboard.`,
                      )
                    }}
                    onConfirm={(amount) => {
                      action({
                        type: 'observePantry',
                        productId: id,
                        quantity: amount.quantity,
                        unit: amount.unit,
                        amounts: [amount],
                        note: state.pantry![id].note,
                        expiresAt: state.pantry![id].expiresAt ?? null,
                        expected: structuredClone(state.pantry![id]),
                      })
                      setOpen(null)
                    }}
                    onAddToList={() => {
                      const habit = habits.get(id)
                      action({
                        type: 'addItem',
                        productId: id,
                        quantity: habit?.quantity || 1,
                        unit: habit?.unit || 'pc',
                        note: habit?.preferredNote ?? '',
                        accumulate: false,
                      })
                    }}
                  />
                ))}
              </div>
            </section>
          ),
      )}
      <Modal
        open={!!pantryEditing}
        onOpenChange={(value) => {
          if (!value) setEditing(null)
        }}
        title="What’s already at home?"
        description="Confirm the total you actually have. We reserve planned ingredients first, then use the remainder for other meals."
      >
        {pantryEditing && (
          <PantryEditor
            key={pantryEditing.id}
            entry={{
              ...pantryEditing,
              name: byId.get(pantryEditing.id)?.name ?? pantryEditing.name,
            }}
            onClose={() => setEditing(null)}
            onEditItem={() => setEditingItem(pantryEditing.id)}
          />
        )}
      </Modal>
      {editedProduct && (
        <ProductEditor
          key={editedProduct.id}
          product={editedProduct}
          onClose={() => setEditingItem(null)}
        />
      )}
      {creating !== null && (
        <ItemEditor
          open
          destination="pantry"
          initialName={creating}
          onClose={() => setCreating(null)}
          onAdded={(product) => show(product.id)}
          onQueued={setMessage}
        />
      )}
      {moving && (
        <MoveDialog
          id={moving}
          name={movedProduct?.name ?? moving}
          products={searchable.filter((p) => p.id !== moving)}
          onClose={() => setMoving(null)}
          onMoved={(product) => {
            setMoving(null)
            setMessage(
              `Moved to ${product.name}. Check the amount if both were recorded.`,
            )
            show(product.id)
          }}
        />
      )}
    </>
  )
}

/** Fixes a misrecognized item: what we have moves to another item. */
function MoveDialog({
  id,
  name,
  products,
  onClose,
  onMoved,
}: {
  id: string
  name: string
  products: Product[]
  onClose: () => void
  onMoved: (product: Product) => void
}) {
  const { state, update } = useApp()
  const custom = state.customProducts.some((product) => product.id === id)
  const used =
    state.items.some((item) => item.id === id) ||
    [...(state.recipeBook ?? []), ...state.customRecipes].some((recipe) =>
      recipe.ingredients.some((ingredient) => ingredient.productId === id),
    )
  // A wrongly recognized item an AI photo created is usually not wanted.
  const [deleteOld, setDeleteOld] = useState(
    custom && !used && !!state.aiAdded?.[id],
  )
  const source = state.customProducts.find((product) => product.id === id)
  function move(product: Product, isNew = false) {
    update((s) => {
      let next = isNew
        ? { ...s, customProducts: [...s.customProducts, product] }
        : s
      next = movePantryEntry(next, id, product.id)
      return deleteOld ? deleteProduct(next, id) : next
    }, `Move ${name} to ${product.name}`)
    onMoved(product)
  }
  return (
    <Modal
      open
      onOpenChange={(value) => {
        if (!value) onClose()
      }}
      title={`Change ${name} to…`}
      description="Pick the right item. What we have moves over and adds to anything already recorded there."
      className="move-dialog"
    >
      <ItemSearch
        id="move"
        state={state}
        products={products}
        label="Find the right item"
        submitLabel="Move here"
        placeholder="Search our items"
        idle={products.filter((p) => state.pantry?.[p.id]).slice(0, 6)}
        idleCaption="In the cupboard"
        describe={(p) =>
          state.pantry?.[p.id]
            ? `In the cupboard · ${amountsLabel(pantryTotal(state, p.id))}`
            : p.category
        }
        createHint="Create it as a new item"
        onPick={(product) => move(product)}
        onCreate={(typed) => {
          if (!typed) return
          move(
            {
              id: crypto.randomUUID(),
              name: typed,
              category: source?.category ?? 'Pantry',
              icon: source?.icon ?? '🛒',
            },
            true,
          )
        }}
      />
      {custom && !used && (
        <label className="check-row">
          <input
            type="checkbox"
            checked={deleteOld}
            onChange={(event) => setDeleteOld(event.target.checked)}
          />
          Also delete “{name}” from our items
        </label>
      )}
    </Modal>
  )
}

function StockRow({
  id,
  product,
  estimate,
  warning,
  habit,
  total,
  entry,
  onList,
  open,
  onToggle,
  onMore,
  onSettings,
  onMove,
  aiAdded,
  onApprove,
  onDismiss,
  shelfLife,
  onUsedUp,
  onRemove,
  onConfirm,
  onAddToList,
}: {
  id: string
  product?: Product
  estimate?: StockEstimate
  warning: 'use-soon' | 'restock' | null
  habit?: Habit
  total: Amount[]
  entry: { confirmed: boolean; expiresAt: string | null; note: string }
  onList: boolean
  open: boolean
  onToggle: () => void
  onMore: () => void
  onSettings: () => void
  onMove: () => void
  aiAdded: boolean
  onApprove: () => void
  onDismiss: () => void
  shelfLife?: number
  onUsedUp: () => void
  onRemove: () => void
  onConfirm: (amount: Amount) => void
  onAddToList: () => void
}) {
  const { state } = useApp()
  const name = product?.name ?? id
  const tracked = estimate?.dailyUse
  const shown = tracked ? estimate.amounts : total
  const editable = shown.length <= 1
  const initial = displayAmount(
    shown[0] ?? {
      quantity: 0,
      unit: tracked?.unit ?? habit?.unit ?? total[0]?.unit ?? 'pc',
    },
  )
  const [draft, setDraft] = useState<Amount>(initial)
  const touched = useRef(false)
  // Follow refreshed estimates until someone starts adjusting the amount.
  useEffect(() => {
    if (!touched.current) setDraft(initial)
  }, [initial.quantity, initial.unit])
  // A dismissed warning shows the row calmly.
  const status = warning ? (estimate?.status ?? 'unknown') : 'calm'
  const level = estimate?.level
  const useWithin = useWithinLabel(estimate, entry.expiresAt)
  const meta = [
    amountsLabel(shown, !!tracked),
    estimate?.daysLeft !== null && estimate?.daysLeft !== undefined
      ? daysLabel(estimate.daysLeft)
      : null,
    useWithin,
    entry.confirmed ? 'confirmed' : null,
  ].filter(Boolean)
  const usedUp = total.every((amount) => amount.quantity <= 0)
  return (
    <div
      id={`stock-row-${id}`}
      className={`stock-row status-${status} ${open ? 'open' : ''}`}
    >
      <button
        className="stock-row-main"
        aria-expanded={open}
        aria-controls={`stock-${id}`}
        onClick={() => {
          if (!open) {
            touched.current = false
            setDraft(initial)
          }
          onToggle()
        }}
      >
        <span className="stock-icon">
          <FoodIcon
            productId={id}
            name={name}
            value={product?.icon ?? '🛒'}
            image={state.productImages?.[id] || product?.image}
          />
        </span>
        <span className="stock-text">
          <strong>
            {name}
            {aiAdded && (
              <span className="ai-badge inline" title="Added by AI">
                <Sparkles size={10} /> AI
              </span>
            )}
          </strong>
          <small>{meta.join(' · ')}</small>
          {level !== null && level !== undefined && (
            <span
              className="stock-level"
              role="meter"
              aria-label={`${name} remaining`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(level * 100)}
            >
              <span style={{ '--level': level } as CSSProperties} />
            </span>
          )}
        </span>
        <ChevronDown size={18} className="stock-chevron" />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={`stock-${id}`}
            className="stock-row-panel"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
          >
            <div className="stock-row-panel-inner">
              {aiAdded && (
                <div className="ai-review">
                  <Sparkles size={16} />
                  <span>Added by AI. Check the amount.</span>
                  <button className="chip-button" onClick={onApprove}>
                    <Check size={14} /> Looks right
                  </button>
                </div>
              )}
              {warning && (
                <div className={`stock-warning ${warning}`}>
                  {warning === 'use-soon' ? (
                    <Clock3 size={16} />
                  ) : (
                    <TriangleAlert size={16} />
                  )}
                  <span>
                    {warning === 'use-soon'
                      ? useWithin
                        ? useWithin[0].toUpperCase() + useWithin.slice(1)
                        : 'Use soon'
                      : usedUp || estimate?.status === 'out'
                        ? 'Probably used up'
                        : 'Running low'}
                  </span>
                  <button
                    className="chip-button"
                    onClick={onDismiss}
                    aria-label={`Dismiss warning for ${name}`}
                  >
                    <BellOff size={14} /> Dismiss
                  </button>
                </div>
              )}
              {editable ? (
                <form
                  className="stock-confirm"
                  onSubmit={(event) => {
                    event.preventDefault()
                    onConfirm(draft)
                    if (aiAdded) onApprove()
                  }}
                >
                  <label>
                    <span>How much is there now?</span>
                    <span className="stock-confirm-row">
                      <QuantityStepper
                        label={`${name} at home`}
                        unit={draft.unit}
                        min={0}
                        value={draft.quantity}
                        onValueChange={(quantity) => {
                          touched.current = true
                          setDraft((current) => ({ ...current, quantity }))
                        }}
                      />
                      <span className="stock-unit">{draft.unit}</span>
                    </span>
                  </label>
                  <button className="primary-button" type="submit">
                    <Check size={16} /> Confirm
                  </button>
                </form>
              ) : (
                <p className="quiet-label">
                  Several units are recorded. Use Edit amounts to adjust each.
                </p>
              )}
              <div className="stock-actions">
                <button
                  className="chip-button"
                  onClick={onAddToList}
                  disabled={onList}
                >
                  {onList ? <Check size={15} /> : <Plus size={15} />}
                  {onList ? 'On the list' : 'Add to list'}
                </button>
                {!usedUp && (
                  <button
                    className="chip-button"
                    onClick={onUsedUp}
                    aria-label={`${name} is used up`}
                  >
                    <PackageOpen size={15} /> Used up
                  </button>
                )}
                <ActionMenu
                  label={`More for ${name}`}
                  actions={[
                    {
                      label: 'Edit amounts & use-by',
                      icon: <SlidersHorizontal size={16} />,
                      onSelect: onMore,
                    },
                    {
                      label: 'Change to another item',
                      icon: <Replace size={16} />,
                      onSelect: onMove,
                    },
                    {
                      label: 'Item settings',
                      icon: <Settings2 size={16} />,
                      onSelect: onSettings,
                    },
                    {
                      label: 'Remove from cupboard',
                      icon: <Trash2 size={16} />,
                      onSelect: onRemove,
                      danger: true,
                    },
                  ]}
                />
              </div>
              {estimate?.dailyUse && (
                <p className="stock-explain">
                  Using about{' '}
                  {(() => {
                    const daily = estimate.dailyUse
                    const weekly = displayAmount({
                      quantity: daily.quantity * 7,
                      unit: daily.unit,
                    })
                    return `${weekly.quantity} ${weekly.unit} a week`
                  })()}{' '}
                  ({estimate.rateSource === 'manual' ? 'your rate' : 'learned'}
                  ). Counted from{' '}
                  {entry.confirmed
                    ? 'your last confirmation'
                    : 'recent purchases'}
                  {shelfLife
                    ? `, using older purchases first and dropping anything kept longer than ${shelfLife} days`
                    : ''}
                  .
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function BarChart({
  values,
  labels,
  title,
  describe,
  highlight,
}: {
  values: number[]
  labels: string[]
  title: string
  describe: (value: number, index: number) => string
  highlight?: number
}) {
  const max = Math.max(1, ...values)
  const peak = values.indexOf(Math.max(...values))
  return (
    <figure className="bar-chart">
      <figcaption>{title}</figcaption>
      <div className="bar-chart-plot" role="list">
        {values.map((value, index) => (
          <div
            key={index}
            role="listitem"
            tabIndex={0}
            className={`bar ${index === (highlight ?? -1) ? 'current' : ''}`}
            aria-label={describe(value, index)}
            style={{ '--value': value / max } as CSSProperties}
          >
            <span className="bar-fill" />
            <span className="bar-tip" aria-hidden="true">
              {describe(value, index)}
            </span>
            {index === peak && value > 0 && (
              <span className="bar-peak" aria-hidden="true">
                {value}
              </span>
            )}
            <span className="bar-label" aria-hidden="true">
              {labels[index]}
            </span>
          </div>
        ))}
      </div>
    </figure>
  )
}

function ShareList({
  rows,
  unit,
}: {
  rows: {
    id: string
    name: string
    count: number
    icon?: ReactNode
    detail?: string
  }[]
  unit: string
}) {
  const max = Math.max(1, ...rows.map((row) => row.count))
  return (
    <ul className="share-list">
      {rows.map((row) => (
        <li key={row.id}>
          {row.icon}
          <span className="share-name">
            {row.name}
            {row.detail && <small>{row.detail}</small>}
          </span>
          <span className="share-bar" aria-hidden="true">
            <span style={{ '--value': row.count / max } as CSSProperties} />
          </span>
          <span className="share-count">
            {row.count}
            <span className="sr-only"> {unit}</span>
          </span>
        </li>
      ))}
    </ul>
  )
}

const weekdayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function TrendsView() {
  const { data: stats, error, loaded } = useStats()
  if (!stats)
    return (
      <p className="quiet-label" role="status">
        {error || (loaded ? 'No statistics yet.' : 'Gathering our numbers…')}
      </p>
    )
  if (!stats.purchases)
    return (
      <div className="cupboard-empty">
        <FoodIcon value="📈" />
        <h3>Trends appear as you shop</h3>
        <p>Check items off in the store and finish a trip or two.</p>
      </div>
    )
  return <Trends stats={stats} />
}

function Trends({ stats }: { stats: HouseholdStats }) {
  const { state, action } = useApp()
  const products = useMemo(() => getProducts(state), [state])
  const icon = (id: string) => {
    const product = products.find((p) => p.id === id)
    return (
      <span className="share-icon">
        <FoodIcon
          productId={id}
          name={product?.name}
          value={product?.icon ?? '🛒'}
          image={state.productImages?.[id] || product?.image}
        />
      </span>
    )
  }
  const since = stats.since
    ? new Date(stats.since).toLocaleDateString('en-GB', {
        month: 'long',
        year: 'numeric',
      })
    : null
  const busiest = stats.weekdays.indexOf(Math.max(...stats.weekdays))
  const weekLabels = stats.weeks.map((week, index) => {
    const date = new Date(`${week.weekStart}T12:00:00`)
    const previous =
      index > 0
        ? new Date(`${stats.weeks[index - 1].weekStart}T12:00:00`)
        : null
    return !previous || previous.getMonth() !== date.getMonth()
      ? date.toLocaleDateString('en-GB', { month: 'short' })
      : ''
  })
  return (
    <div className="trends">
      <div className="stat-tiles">
        <div className="stat-tile">
          <span>Trips</span>
          <strong>{stats.trips}</strong>
          {since && <small>since {since}</small>}
        </div>
        <div className="stat-tile">
          <span>Items bought</span>
          <strong>{stats.purchases}</strong>
          <small>{stats.distinctProducts} different things</small>
        </div>
        {stats.averageTripItems !== null && (
          <div className="stat-tile">
            <span>Per trip</span>
            <strong>{stats.averageTripItems}</strong>
            <small>items on average</small>
          </div>
        )}
        {stats.averageTripMinutes !== null ? (
          <div className="stat-tile">
            <span>Trip time</span>
            <strong>{stats.averageTripMinutes}</strong>
            <small>minutes on average</small>
          </div>
        ) : stats.medianDaysBetweenTrips !== null ? (
          <div className="stat-tile">
            <span>Rhythm</span>
            <strong>{stats.medianDaysBetweenTrips}</strong>
            <small>days between trips</small>
          </div>
        ) : null}
      </div>
      <section className="trend-card">
        <BarChart
          title="Items bought per week"
          values={stats.weeks.map((week) => week.items)}
          labels={weekLabels}
          highlight={stats.weeks.length - 1}
          describe={(value, index) =>
            `Week of ${new Date(`${stats.weeks[index].weekStart}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}: ${value} items, ${stats.weeks[index].trips} trips`
          }
        />
      </section>
      <section className="trend-card">
        <BarChart
          title="When we shop"
          values={stats.weekdays}
          labels={weekdayNames}
          highlight={busiest}
          describe={(value, index) =>
            `${weekdayNames[index]}: ${value} shopping days`
          }
        />
        {stats.weekdays[busiest] > 0 && (
          <p className="trend-note">
            {
              [
                'Mondays',
                'Tuesdays',
                'Wednesdays',
                'Thursdays',
                'Fridays',
                'Saturdays',
                'Sundays',
              ][busiest]
            }{' '}
            are our big shopping day.
          </p>
        )}
      </section>
      <div className="trend-columns">
        <section className="trend-card">
          <h2>Our staples</h2>
          <ShareList
            unit="purchases"
            rows={stats.topProducts.map((product) => ({
              id: product.productId,
              name: product.name,
              detail: product.intervalDays
                ? `every ${product.intervalDays} days`
                : undefined,
              count: product.count,
              icon: icon(product.productId),
            }))}
          />
        </section>
        <section className="trend-card">
          <h2>By group</h2>
          <ShareList
            unit="items"
            rows={stats.groups.map((group) => ({ ...group }))}
          />
        </section>
        {stats.shoppers.length > 1 && (
          <section className="trend-card">
            <h2>Who checks things off</h2>
            <ShareList
              unit="items"
              rows={stats.shoppers.map((shopper) => ({ ...shopper }))}
            />
          </section>
        )}
        {stats.stores.length > 1 && (
          <section className="trend-card">
            <h2>Where we shop</h2>
            <ShareList
              unit="trips"
              rows={stats.stores.map((store) => ({ ...store }))}
            />
          </section>
        )}
        {(stats.mealsCooked > 0 || stats.mealsSkipped > 0) && (
          <section className="trend-card">
            <h2>Lunches</h2>
            <p className="trend-note">
              {stats.mealsCooked} cooked · {stats.mealsSkipped} skipped
            </p>
            <ShareList
              unit="times cooked"
              rows={stats.topRecipes.map((recipe) => ({
                id: recipe.recipeId,
                name: recipe.name,
                detail:
                  recipe.rating !== null
                    ? `rated ${recipe.rating} of 5`
                    : undefined,
                count: recipe.cooked,
              }))}
            />
          </section>
        )}
        {stats.lapsed.length > 0 && (
          <section className="trend-card">
            <h2>Haven’t bought in a while</h2>
            <ul className="lapsed-list">
              {stats.lapsed.map((product) => (
                <li key={product.productId}>
                  {icon(product.productId)}
                  <span>
                    <strong>{product.name}</strong>
                    <small>
                      Usually every {product.intervalDays} days · last{' '}
                      {new Date(product.lastBought).toLocaleDateString(
                        'en-GB',
                        { day: 'numeric', month: 'short' },
                      )}
                    </small>
                  </span>
                  <button
                    className="icon-button"
                    aria-label={`Add ${product.name} to the list`}
                    onClick={() =>
                      action({
                        type: 'addItem',
                        productId: product.productId,
                        quantity: 1,
                        unit: 'pc',
                        note: '',
                        accumulate: false,
                      })
                    }
                  >
                    <Plus size={17} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  )
}

function HistoryView() {
  const { state, action, session } = useApp()
  const { insights } = useLearning()
  const { history, error } = useHistory()
  const products = useMemo(() => getProducts(state), [state])
  const name = (id: unknown) =>
    products.find((p) => p.id === id)?.name ?? String(id)
  return (
    <>
      <section className="trend-card history-learning">
        <h2>What we’re learning</h2>
        <p className="quiet-label">
          {insights.purchaseCount} likely purchases recorded. A checked item
          counts as bought; restore it or undo an event to correct the record.
          Estimates start after three purchases on separate days.
        </p>
        {insights.associations.slice(0, 4).map((pair) => (
          <p className="quiet-label" key={pair.products.join(':')}>
            {pair.products.map(name).join(' + ')} bought together on{' '}
            {pair.daysTogether} days.
          </p>
        ))}
      </section>
      {error && <p className="form-error">{error}</p>}
      <div className="history-list">
        {history.map((event) => {
          const detail = event.detail as Record<string, unknown>
          return (
            <div key={event.id}>
              <span className="history-kind" aria-hidden="true">
                <History size={14} />
              </span>
              <span>
                <strong>
                  {event.kind === 'checkItem'
                    ? `${detail.checked ? 'Bought' : 'Restored'} ${name(detail.productId)}`
                    : event.kind === 'patch'
                      ? String(detail.label || 'Updated household')
                      : event.kind === 'mealFeedback'
                        ? `${detail.status} lunch`
                        : event.kind === 'finishTrip'
                          ? `Finished shopping${detail.automatic ? ' automatically' : ''} · ${detail.count ?? 0} items`
                          : event.kind === 'addItem'
                            ? `Added ${name(detail.productId)}`
                            : event.kind === 'observePantry'
                              ? `Confirmed ${name(detail.productId)} at home`
                              : event.kind === 'autoConsume'
                                ? 'Used ingredients for planned lunch'
                                : event.kind === 'generateItemIcon'
                                  ? `Generated icon for ${detail.name ?? 'an item'}`
                                  : event.kind}
                </strong>
                <small>
                  {event.actor} ·{' '}
                  {new Date(event.at).toLocaleString(undefined, {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}
                  {event.undone ? ' · undone' : ''}
                </small>
              </span>
              {!event.undone &&
                !['undo', 'resetHistory'].includes(event.kind) && (
                  <button
                    className="text-button"
                    onClick={() => action({ type: 'undo', eventId: event.id })}
                  >
                    Undo
                  </button>
                )}
            </div>
          )
        })}
      </div>
      {session.user.role === 'owner' && (
        <button
          className="text-button danger"
          onClick={() => {
            if (
              confirm(
                'Reset shopping and cooking learning history? Your recipes and shopping list remain.',
              )
            )
              action({ type: 'resetHistory' })
          }}
        >
          <RefreshCw size={15} /> Reset learning history
        </button>
      )}
    </>
  )
}
