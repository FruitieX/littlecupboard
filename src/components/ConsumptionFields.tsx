import { NumberInput } from './NumberInput'
import type { ConsumptionRate } from '../lib/api/ConsumptionRate'

export function rateLabel(rate: ConsumptionRate) {
  return `${rate.quantity} ${rate.unit} every ${rate.days} ${rate.days === 1 ? 'day' : 'days'}`
}

export function ConsumptionFields({
  value,
  onChange,
  suggested,
  purchases,
}: {
  value?: ConsumptionRate
  onChange: (rate: ConsumptionRate | undefined) => void
  suggested?: ConsumptionRate
  purchases?: number
}) {
  return (
    <fieldset className="consumption-fields">
      <legend>Consumption rate</legend>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={!!value}
          onChange={(event) =>
            onChange(
              event.target.checked
                ? (suggested ?? { quantity: 1, unit: 'pc', days: 7 })
                : undefined,
            )
          }
        />
        Set consumption rate
      </label>
      {value && (
        <div className="consumption-row">
          <label>
            Quantity
            <NumberInput
              aria-label="Consumption quantity"
              min="0.001"
              max="1000000"
              step="any"
              required
              value={value.quantity}
              onValueChange={(quantity) => onChange({ ...value, quantity })}
            />
          </label>
          <label>
            Unit
            <input
              aria-label="Consumption unit"
              required
              maxLength={30}
              value={value.unit}
              onChange={(e) => onChange({ ...value, unit: e.target.value })}
            />
          </label>
          <label>
            Every (days)
            <NumberInput
              aria-label="Consumption period (days)"
              min="0.1"
              max="3650"
              step="any"
              required
              value={value.days}
              onValueChange={(days) => onChange({ ...value, days })}
            />
          </label>
        </div>
      )}
      {suggested ? (
        <div className="consumption-estimate">
          <p>
            Estimated: <strong>{rateLabel(suggested)}</strong>
            <small>
              Based on {purchases} likely purchases. Buying frequency is a
              guide; actual use may vary.
            </small>
          </p>
          <button
            type="button"
            className="text-button"
            onClick={() => onChange({ ...suggested })}
          >
            Use estimated rate
          </button>
        </div>
      ) : (
        <p className="quiet-label">
          For example, 4 L every 7 days. Without a setting, we learn from at
          least three shopping days with compatible quantities.
        </p>
      )}
      {value && (
        <p className="quiet-label">
          Your saved rate takes priority over estimates. Uncheck to return to
          learning.
        </p>
      )}
    </fieldset>
  )
}

// Rough starting points; the household can adjust them per item.
const typicalShelfLife: [RegExp, number][] = [
  // Long-life products: no suggestion.
  [/peanut butter|powder|dried|frozen|canned|tinned|flour|sugar|uht/i, 0],
  [/milk|cream|kefir|buttermilk/i, 7],
  [/yog(h)?urt|quark|cottage|cream cheese/i, 10],
  [/bread|rolls|bun|bagel|croissant|pastr|pita/i, 4],
  [/salad|spinach|herb|basil|parsley|coriander|dill|berr|raspberr/i, 4],
  [/banana|avocado|tomato|mushroom/i, 5],
  [/chicken|mince|fish|salmon|meat|sausage|ham|turkey|pork|lamb/i, 3],
  [/egg/i, 21],
  [/cheese|butter/i, 21],
  [/apple|orange|lemon|lime|carrot|potato|onion|cabbage/i, 21],
]
export function typicalShelfLifeDays(name: string) {
  return (
    typicalShelfLife.find(([pattern]) => pattern.test(name))?.[1] || undefined
  )
}

export function ShelfLifeFields({
  value,
  onChange,
  name,
}: {
  value?: number
  onChange: (days: number | undefined) => void
  name: string
}) {
  const typical = typicalShelfLifeDays(name)
  return (
    <fieldset className="shelf-life-fields">
      <legend>Shelf life</legend>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={value !== undefined}
          onChange={(event) =>
            onChange(event.target.checked ? (typical ?? 7) : undefined)
          }
        />
        Spoils after a while
      </label>
      {value !== undefined && (
        <label className="shelf-life-row">
          Keeps for about
          <NumberInput
            aria-label="Shelf life (days)"
            min="0.5"
            max="3650"
            step="any"
            required
            value={value}
            onValueChange={onChange}
          />
          days after buying
        </label>
      )}
      <p className="quiet-label">
        Optional. The cupboard then uses older purchases first, flags what to
        use soon and stops counting anything past its shelf life
        {typical && value === undefined
          ? ` (usually about ${typical} days)`
          : ''}
        .
      </p>
    </fieldset>
  )
}
