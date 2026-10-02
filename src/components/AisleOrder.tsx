import { useState } from 'react'
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react'

export function AisleOrder({
  order,
  groups,
  onChange,
}: {
  order: string[]
  groups: string[]
  onChange: (order: string[]) => void
}) {
  const [query, setQuery] = useState('')
  const available = groups.filter(
    (group) =>
      !order.includes(group) &&
      group.toLowerCase().includes(query.trim().toLowerCase()),
  )
  function move(index: number, direction: number) {
    const next = [...order]
    ;[next[index], next[index + direction]] = [
      next[index + direction],
      next[index],
    ]
    onChange(next)
  }
  return (
    <div className="aisle-editor">
      <ol className="aisle-list" aria-label="Shop aisle order">
        {order.map((group, index) => (
          <li key={group}>
            <span className="aisle-number">
              {String(index + 1).padStart(2, '0')}
            </span>
            <strong>{group}</strong>
            <div>
              <button
                type="button"
                className="icon-button"
                disabled={index === 0}
                onClick={() => move(index, -1)}
                aria-label={`Move ${group} up`}
              >
                <ArrowUp size={16} />
              </button>
              <button
                type="button"
                className="icon-button"
                disabled={index === order.length - 1}
                onClick={() => move(index, 1)}
                aria-label={`Move ${group} down`}
              >
                <ArrowDown size={16} />
              </button>
              <button
                type="button"
                className="icon-button"
                onClick={() => onChange(order.filter((name) => name !== group))}
                aria-label={`Remove ${group} from shop`}
              >
                <X size={16} />
              </button>
            </div>
          </li>
        ))}
      </ol>
      {!order.length && (
        <p className="quiet-label">
          No aisles selected. Items use the list’s default order.
        </p>
      )}
      {groups.some((group) => !order.includes(group)) && (
        <details className="aisle-add">
          <summary>
            <Plus size={16} /> Add aisles
          </summary>
          <label>
            Find an item group
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search available groups"
            />
          </label>
          <div className="group-list">
            {available.map((group) => (
              <button
                type="button"
                className="group-chip"
                key={group}
                onClick={() => {
                  onChange([...order, group])
                  setQuery('')
                }}
                aria-label={`Add ${group} to shop`}
              >
                <Plus size={14} />
                {group}
              </button>
            ))}
          </div>
          {!available.length && (
            <p className="quiet-label">No matching groups.</p>
          )}
        </details>
      )}
    </div>
  )
}
