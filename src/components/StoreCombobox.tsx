import { matchesSearch } from '../lib/search'
import { useEffect, useId, useRef, useState } from 'react'
import { Check, ChevronDown, MapPin } from 'lucide-react'
import { useApp } from '../lib/state'
import type { Store } from '../lib/data'

export function StoreCombobox() {
  const { state, update } = useApp()
  const store =
    state.stores.find((candidate) => candidate.id === state.storeId) ??
    state.stores[0]
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(-1)
  const input = useRef<HTMLInputElement>(null)
  const id = useId()
  const matches = state.stores.filter((candidate) =>
    matchesSearch([candidate.name, candidate.location], query),
  )
  const visible = matches.slice(0, 12)
  useEffect(() => {
    if (open && index >= 0)
      document
        .getElementById(`${id}-${index}`)
        ?.scrollIntoView({ block: 'nearest' })
  }, [open, index, id])
  function choose(candidate: Store) {
    update((current) => ({ ...current, storeId: candidate.id }))
    setOpen(false)
    setQuery('')
    setIndex(-1)
    input.current?.blur()
  }
  return (
    <div
      className="store-combobox"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) {
          setOpen(false)
          setQuery('')
          setIndex(-1)
        }
      }}
    >
      <div className="store-picker">
        {store.image ? (
          <img src={store.image} alt="" />
        ) : (
          <MapPin size={16} aria-hidden="true" />
        )}
        <span className="store-field">
          <input
            ref={input}
            data-open={open || undefined}
            role="combobox"
            aria-label="Shopping at"
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls={`${id}-list`}
            aria-activedescendant={
              open && index >= 0 ? `${id}-${index}` : undefined
            }
            value={open ? query : store.name}
            placeholder={open ? 'Search…' : store.name}
            autoComplete="off"
            onFocus={() => {
              setOpen(true)
              setQuery('')
              setIndex(-1)
            }}
            onChange={(event) => {
              setQuery(event.target.value)
              setOpen(true)
              setIndex(-1)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                setOpen(false)
                setQuery('')
                input.current?.blur()
              }
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault()
                setOpen(true)
                setIndex((current) =>
                  visible.length
                    ? Math.max(
                        0,
                        Math.min(
                          visible.length - 1,
                          current + (event.key === 'ArrowDown' ? 1 : -1),
                        ),
                      )
                    : -1,
                )
              }
              if (event.key === 'Enter') {
                event.preventDefault()
                const selected =
                  visible[index] ??
                  (visible.length === 1 ? visible[0] : undefined)
                if (selected) choose(selected)
              }
            }}
          />
          {!open && (
            <span className="store-name" aria-hidden="true">
              <span>{store.name}</span>
            </span>
          )}
        </span>
        <button
          className="store-toggle"
          aria-label="Choose a shop"
          type="button"
          onClick={() => {
            const next = !open
            if (next) input.current?.focus()
            setOpen(next)
            if (!next) setQuery('')
          }}
          onMouseDown={(event) => event.preventDefault()}
        >
          <ChevronDown size={14} />
        </button>
      </div>
      {open && (
        <div
          className="store-suggestions"
          onMouseDown={(event) => event.preventDefault()}
        >
          <div role="listbox" id={`${id}-list`} aria-label="Configured shops">
            {visible.map((candidate, i) => (
              <button
                key={candidate.id}
                id={`${id}-${i}`}
                role="option"
                aria-selected={index === i}
                onClick={() => choose(candidate)}
              >
                {candidate.image && (
                  <img className="store-picture" src={candidate.image} alt="" />
                )}
                <span>
                  <strong>{candidate.name}</strong>
                  {candidate.location && <small>{candidate.location}</small>}
                </span>
                {store.id === candidate.id && <Check size={16} />}
              </button>
            ))}
          </div>
          {!matches.length && <p>No matching shops.</p>}
          {matches.length > visible.length && (
            <p>
              {visible.length} of {matches.length} shops · keep typing to find
              yours
            </p>
          )}
        </div>
      )}
    </div>
  )
}
