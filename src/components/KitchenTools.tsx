import { getProducts } from '../lib/catalog'
import { useState } from 'react'
import {
  Archive,
  History,
  Plus,
  X,
  Check,
  RefreshCw,
  Pencil,
} from 'lucide-react'
import { useApp } from '../lib/state'
import { useLearning } from '../lib/learning'
import { Modal, SectionTitle } from './ui'
import { FoodIcon } from './FoodIcon'
import { PantryEditor, pantryEdit, type PantryEdit } from './PantryEditor'
export function KitchenTools() {
  const { state, update, action, session } = useApp()
  const { insights, history, error } = useLearning()
  const [open, setOpen] = useState<'pantry' | 'history' | null>(null)
  const [editing, setEditing] = useState<PantryEdit | null>(null)
  const [name, setName] = useState('')
  const [quantity, setQuantity] = useState(1)
  const [unit, setUnit] = useState('pc')
  const [expiry, setExpiry] = useState('')
  const products = getProducts(state)
  const product = products.find(
    (p) => p.name.toLowerCase() === name.toLowerCase(),
  )
  return (
    <>
      <div className="kitchen-tools">
        <button className="text-button" onClick={() => setOpen('pantry')}>
          <Archive size={15} /> Pantry
        </button>
        <button className="text-button" onClick={() => setOpen('history')}>
          <History size={15} /> History
        </button>
      </div>
      <Modal
        open={open === 'pantry'}
        onOpenChange={(v) => {
          if (!v) {
            setOpen(null)
            setEditing(null)
          }
        }}
        title="What’s already at home?"
        description="Confirm the total you actually have. We reserve planned ingredients first, then use the remainder for other meals."
      >
        {editing && (
          <PantryEditor
            key={editing.id}
            entry={editing}
            onClose={() => setEditing(null)}
          />
        )}
        <div hidden={!!editing}>
          <form
            className="editor-form"
            onSubmit={(e) => {
              e.preventDefault()
              if (!product) return
              action({
                type: 'observePantry',
                productId: product.id,
                quantity,
                unit,
                expiresAt: expiry || null,
              })
              setName('')
            }}
          >
            <label>
              Pantry item
              <input
                list="pantry-products"
                value={name}
                required
                onChange={(e) => setName(e.target.value)}
                placeholder="Search your ingredients"
              />
              <datalist id="pantry-products">
                {products.map((p) => (
                  <option key={p.id} value={p.name} />
                ))}
              </datalist>
            </label>
            <div className="form-row">
              <label>
                Quantity
                <input
                  type="number"
                  required
                  min="0"
                  step="any"
                  value={quantity}
                  onChange={(e) => setQuantity(Number(e.target.value))}
                />
              </label>
              <label>
                Unit
                <input
                  required
                  maxLength={30}
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                />
              </label>
            </div>
            <label>
              Use by <span className="optional">optional</span>
              <input
                aria-label="Use by"
                type="date"
                value={expiry}
                onChange={(e) => setExpiry(e.target.value)}
              />
            </label>
            <button className="secondary-button" disabled={!product}>
              <Check size={16} /> Confirm amount
            </button>
          </form>
          <div className="pantry-list">
            {Object.entries(state.pantry ?? {}).map(([id, entry]) => {
              const product = products.find((p) => p.id === id)
              const reserved = Object.values(state.purchasedCoverage ?? {})
                .flatMap((day) => day[id] ?? [])
                .reduce(
                  (sum, amount) => ({
                    ...sum,
                    [amount.unit]: (sum[amount.unit] ?? 0) + amount.quantity,
                  }),
                  {} as Record<string, number>,
                )
              return (
                <div key={id}>
                  <FoodIcon
                    value={product?.icon ?? '🛒'}
                    image={state.productImages?.[id]}
                  />
                  <span>
                    <strong>{product?.name ?? id}</strong>
                    <small>
                      {entry.amounts
                        .map((a) => `${a.quantity} ${a.unit}`)
                        .join(' + ') || 'No remaining amount'}{' '}
                      ·{' '}
                      {entry.confirmed
                        ? 'Confirmed'
                        : 'Estimated — worth checking'}
                      {Object.keys(reserved).length
                        ? ' · reserved for meals: ' +
                          Object.entries(reserved)
                            .map(([unit, quantity]) => quantity + ' ' + unit)
                            .join(' + ')
                        : ''}
                      {entry.expiresAt ? ` · use by ${entry.expiresAt}` : ''}
                      {entry.note ? ` · ${entry.note}` : ''}
                    </small>
                  </span>
                  <button
                    className="icon-button"
                    aria-label={`Edit ${product?.name ?? id} in pantry`}
                    onClick={() =>
                      setEditing(pantryEdit(state, id, product?.name ?? id))
                    }
                  >
                    <Pencil size={16} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label={`Remove ${product?.name} from pantry`}
                    onClick={() =>
                      update(
                        (s) => {
                          const pantry = { ...s.pantry }
                          delete pantry[id]
                          return { ...s, pantry }
                        },
                        `Remove ${product?.name ?? id} from pantry`,
                      )
                    }
                  >
                    <X size={16} />
                  </button>
                </div>
              )
            })}
          </div>
          {!Object.keys(state.pantry ?? {}).length && (
            <p className="quiet-label">
              Confirm a few staples to avoid buying them twice.
            </p>
          )}
        </div>
      </Modal>
      <Modal
        open={open === 'history'}
        onOpenChange={(v) => {
          if (!v) setOpen(null)
        }}
        title="Our shopping & cooking"
        description="A checked item is a likely purchase. Restore it or undo an event to correct the record. Undo needs the affected fields to still match."
      >
        <SectionTitle title="What we’re learning" />
        <p className="quiet-label">
          {insights.purchaseCount} likely purchases recorded. Restock
          suggestions start after three purchases on separate days.
        </p>
        {insights.habits
          .filter((h) => h.intervalDays)
          .slice(0, 8)
          .map((h) => (
            <p key={h.productId}>
              <strong>{h.name}</strong> · about every {h.intervalDays} days ·{' '}
              {h.confidence} · {h.quantity} {h.unit} ·{' '}
              {state.stores.find((s) => s.id === h.storeId)?.name ??
                'Shop no longer configured'}
              {h.preferredNote ? ` · ${h.preferredNote}` : ''}
            </p>
          ))}
        {Object.keys(insights.shoppingDays).length > 0 && (
          <p className="quiet-label">
            Most shopping:{' '}
            {Object.entries(insights.shoppingDays)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 2)
              .map(([day]) => day)
              .join(', ')}
            .
          </p>
        )}
        {insights.associations.map((pair) => (
          <p className="quiet-label" key={pair.products.join(':')}>
            {pair.products
              .map((id) => products.find((p) => p.id === id)?.name ?? id)
              .join(' + ')}{' '}
            bought together on {pair.daysTogether} days.
          </p>
        ))}
        {error && <p className="form-error">{error}</p>}
        <div className="history-list">
          {history.map((event) => {
            const detail = event.detail as Record<string, unknown>
            return (
              <div key={event.id}>
                <span>
                  <strong>
                    {event.kind === 'checkItem'
                      ? `${detail.checked ? 'Bought' : 'Restored'} ${products.find((p) => p.id === detail.productId)?.name ?? detail.productId}`
                      : event.kind === 'patch'
                        ? 'Updated household'
                        : event.kind === 'mealFeedback'
                          ? `${detail.status} lunch`
                          : event.kind === 'finishTrip'
                            ? 'Finished shopping'
                            : event.kind === 'addItem'
                              ? `Added ${products.find((p) => p.id === detail.productId)?.name ?? detail.productId}`
                              : event.kind === 'generateItemIcon'
                                ? `Generated icon for ${detail.name ?? 'an item'}`
                                : event.kind}
                  </strong>
                  <small>
                    {event.actor} · {new Date(event.at).toLocaleString()}
                    {event.undone ? ' · undone' : ''}
                  </small>
                </span>
                {!event.undone &&
                  !['undo', 'resetHistory'].includes(event.kind) && (
                    <button
                      className="text-button"
                      onClick={() =>
                        action({ type: 'undo', eventId: event.id })
                      }
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
      </Modal>
    </>
  )
}
