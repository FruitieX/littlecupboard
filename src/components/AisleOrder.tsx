import { matchesSearch } from '../lib/search'
import { useEffect, useRef, useState } from 'react'
import type { PointerEvent } from 'react'
import { Reorder, useDragControls } from 'motion/react'
import { GripVertical, Plus, X } from 'lucide-react'

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
  // Reorder locally while dragging and save once on drop.
  const [items, setItems] = useState(order)
  const dragging = useRef(false)
  const latest = useRef(items)
  latest.current = items
  useEffect(() => {
    if (!dragging.current) setItems(order)
  }, [order])
  const available = groups.filter(
    (group) => !order.includes(group) && matchesSearch([group], query),
  )
  function commit() {
    dragging.current = false
    if (latest.current.join('\n') !== order.join('\n')) onChange(latest.current)
  }
  function move(index: number, direction: number) {
    const target = index + direction
    if (target < 0 || target >= order.length) return
    const next = [...order]
    ;[next[index], next[target]] = [next[target], next[index]]
    onChange(next)
  }
  return (
    <div className="aisle-editor">
      <p id="aisle-reorder-help" className="sr-only">
        Drag the handle to reorder, or focus it and use the up and down arrow
        keys.
      </p>
      <Reorder.Group
        as="ol"
        axis="y"
        values={items}
        onReorder={setItems}
        className="aisle-list"
        aria-label="Shop aisle order"
      >
        {items.map((group, index) => (
          <AisleRow
            key={group}
            group={group}
            index={index}
            onDragStart={() => (dragging.current = true)}
            onDragEnd={commit}
            onMove={(direction) => move(order.indexOf(group), direction)}
            onRemove={() => onChange(order.filter((name) => name !== group))}
          />
        ))}
      </Reorder.Group>
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

function AisleRow({
  group,
  index,
  onDragStart,
  onDragEnd,
  onMove,
  onRemove,
}: {
  group: string
  index: number
  onDragStart: () => void
  onDragEnd: () => void
  onMove: (direction: number) => void
  onRemove: () => void
}) {
  const controls = useDragControls()
  return (
    <Reorder.Item
      value={group}
      dragListener={false}
      dragControls={controls}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      whileDrag={{
        scale: 1.02,
        borderRadius: 12,
        boxShadow: '0 10px 24px #293b3024',
      }}
      transition={{ type: 'spring', stiffness: 600, damping: 40 }}
      className="aisle-row"
    >
      <button
        type="button"
        className="aisle-handle"
        aria-label={`Reorder ${group}, position ${index + 1}`}
        aria-describedby="aisle-reorder-help"
        onPointerDown={(event: PointerEvent<HTMLButtonElement>) => {
          event.preventDefault()
          controls.start(event)
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault()
            onMove(event.key === 'ArrowUp' ? -1 : 1)
            // Keep focus on the moved row's handle after it re-renders.
            const button = event.currentTarget
            requestAnimationFrame(() => button.focus())
          }
        }}
      >
        <GripVertical size={18} />
      </button>
      <span className="aisle-number">{String(index + 1).padStart(2, '0')}</span>
      <strong>{group}</strong>
      <button
        type="button"
        className="icon-button"
        onClick={onRemove}
        aria-label={`Remove ${group} from shop`}
      >
        <X size={16} />
      </button>
    </Reorder.Item>
  )
}
