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
            <input
              aria-label="Consumption quantity"
              type="number"
              min="0.001"
              max="1000000"
              step="any"
              required
              value={value.quantity}
              onChange={(e) =>
                onChange({ ...value, quantity: Number(e.target.value) })
              }
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
            <input
              aria-label="Consumption period (days)"
              type="number"
              min="0.1"
              max="3650"
              step="any"
              required
              value={value.days}
              onChange={(e) =>
                onChange({ ...value, days: Number(e.target.value) })
              }
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
