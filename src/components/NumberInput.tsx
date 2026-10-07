import { useEffect, useState, type ComponentProps } from 'react'
import { Minus, Plus } from 'lucide-react'

type Props = Omit<
  ComponentProps<'input'>,
  'type' | 'value' | 'defaultValue' | 'onChange'
> & {
  value: number
  onValueChange: (value: number) => void
  revertInvalidOnBlur?: boolean
}

/** Keep editing text separate from validated quantities in household state. */
export function NumberInput({
  value,
  onValueChange,
  revertInvalidOnBlur = false,
  onBlur,
  inputMode,
  step,
  ...props
}: Props) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => {
    setDraft((current) =>
      current.trim() && Number(current) === value ? current : String(value),
    )
  }, [value])
  return (
    <input
      {...props}
      type="number"
      inputMode={
        inputMode ??
        (step === 'any' || String(step).includes('.') ? 'decimal' : 'numeric')
      }
      step={step}
      value={draft}
      onChange={(event) => {
        const text = event.currentTarget.value
        setDraft(text)
        if (
          text.trim() &&
          event.currentTarget.validity.valid &&
          Number.isFinite(Number(text))
        )
          onValueChange(Number(text))
      }}
      onBlur={(event) => {
        if (
          revertInvalidOnBlur &&
          (!draft.trim() || !event.currentTarget.validity.valid)
        )
          setDraft(String(value))
        else if (draft.trim() && event.currentTarget.validity.valid)
          setDraft(String(Number(draft)))
        onBlur?.(event)
      }}
    />
  )
}

/** A sensible increment for common grocery units. */
export function quantityStep(unit: string) {
  const normalized = unit.trim().toLowerCase()
  if (['g', 'ml'].includes(normalized)) return 100
  if (['kg', 'l'].includes(normalized)) return 0.5
  return 1
}

/** Number field with large touch-friendly decrement and increment buttons. */
export function QuantityStepper({
  value,
  onValueChange,
  unit,
  label,
  min = 0.01,
  ...props
}: Omit<Props, 'min'> & { unit: string; label: string; min?: number }) {
  const step = quantityStep(unit)
  const round = (next: number) => Math.round(next * 1000) / 1000
  return (
    <div className="quantity-stepper">
      <button
        type="button"
        aria-label={`Less ${label}`}
        disabled={value - step < min}
        onClick={() => onValueChange(round(Math.max(min, value - step)))}
      >
        <Minus size={18} />
      </button>
      <NumberInput
        {...props}
        aria-label={label}
        min={min}
        step="any"
        value={value}
        onValueChange={onValueChange}
      />
      <button
        type="button"
        aria-label={`More ${label}`}
        onClick={() => onValueChange(round(value + step))}
      >
        <Plus size={18} />
      </button>
    </div>
  )
}
