import { useState } from 'react'
import { Check, Plus, X } from 'lucide-react'
import type { AppState, Amount } from '../lib/data'
import type { PantryItem } from '../lib/api/PantryItem'
import { pantryTotal } from '../lib/meal-shopping'
import { useApp } from '../lib/state'

export type PantryEdit = {
  id: string
  name: string
  expected: PantryItem
  amounts: Amount[]
}
export function pantryEdit(
  state: AppState,
  id: string,
  name: string,
): PantryEdit {
  return {
    id,
    name,
    expected: structuredClone(state.pantry![id]),
    amounts: pantryTotal(state, id),
  }
}

export function PantryEditor({
  entry,
  onClose,
}: {
  entry: PantryEdit
  onClose: () => void
}) {
  const { action } = useApp()
  const [amounts, setAmounts] = useState<Amount[]>(
    entry.amounts.length ? entry.amounts : [{ quantity: 0, unit: 'pc' }],
  )
  const [expiry, setExpiry] = useState(entry.expected.expiresAt ?? '')
  const [note, setNote] = useState(entry.expected.note)
  return (
    <form
      className="editor-form pantry-editor"
      onSubmit={(e) => {
        e.preventDefault()
        action({
          type: 'observePantry',
          productId: entry.id,
          quantity: amounts[0].quantity,
          unit: amounts[0].unit,
          amounts,
          note,
          expiresAt: expiry || null,
          expected: entry.expected,
        })
        onClose()
      }}
    >
      <h3>Edit {entry.name}</h3>
      <p className="quiet-label">
        Enter the total at home, including anything reserved for meals. Saving
        confirms these amounts and recalculates missing ingredients.
      </p>
      {amounts.map((amount, index) => (
        <div className="pantry-amount-row" key={index}>
          <label>
            Quantity
            <input
              aria-label={`Pantry quantity ${index + 1}`}
              autoFocus={index === 0}
              type="number"
              min="0"
              max="1000000"
              step="any"
              required
              value={amount.quantity}
              onChange={(e) =>
                setAmounts((current) =>
                  current.map((a, i) =>
                    i === index
                      ? { ...a, quantity: Number(e.target.value) }
                      : a,
                  ),
                )
              }
            />
          </label>
          <label>
            Unit
            <input
              aria-label={`Pantry unit ${index + 1}`}
              required
              maxLength={30}
              value={amount.unit}
              onChange={(e) =>
                setAmounts((current) =>
                  current.map((a, i) =>
                    i === index ? { ...a, unit: e.target.value } : a,
                  ),
                )
              }
            />
          </label>
          {amounts.length > 1 && (
            <button
              type="button"
              className="icon-button"
              aria-label={`Remove pantry amount ${index + 1}`}
              onClick={() =>
                setAmounts((current) => current.filter((_, i) => i !== index))
              }
            >
              <X size={16} />
            </button>
          )}
        </div>
      ))}
      {amounts.length < 20 && (
        <button
          type="button"
          className="text-button"
          onClick={() =>
            setAmounts((current) => [...current, { quantity: 1, unit: 'pc' }])
          }
        >
          <Plus size={15} />
          Add another amount
        </button>
      )}
      <label>
        Use by{' '}
        <input
          aria-label="Pantry use by"
          type="date"
          value={expiry}
          onChange={(e) => setExpiry(e.target.value)}
        />
      </label>
      <label>
        Notes
        <textarea
          aria-label="Pantry notes"
          maxLength={500}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Opened pack, brand, storage location…"
        />
      </label>
      <div className="modal-actions">
        <button type="button" className="secondary-button" onClick={onClose}>
          Cancel
        </button>
        <button className="primary-button">
          <Check size={16} />
          Save pantry entry
        </button>
      </div>
    </form>
  )
}
