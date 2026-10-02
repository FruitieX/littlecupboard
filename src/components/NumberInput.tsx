import { useEffect, useState, type ComponentProps } from 'react'

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
