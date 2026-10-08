import { useEffect, useId, useState } from 'react'
import { Plus } from 'lucide-react'
import type { Product } from '../lib/data'
import { matchesSearch } from '../lib/search'
import { FoodIcon } from './FoodIcon'

export function IngredientPicker({
  value,
  onChange,
  products,
  label = 'Ingredient',
  required = false,
}: {
  value: string
  onChange: (name: string) => void
  products: Product[]
  label?: string
  required?: boolean
}) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const query = value.trim().toLowerCase()
  const matches = products
    .filter((product) =>
      matchesSearch(
        [product.name, product.category, ...(product.aliases ?? [])],
        query,
      ),
    )
    .sort(
      (a, b) =>
        Number(b.name.toLowerCase() === query) -
        Number(a.name.toLowerCase() === query),
    )
    .slice(0, 8)
  const create =
    !!query && !products.some((product) => product.name.toLowerCase() === query)
  const count = matches.length + Number(create)
  useEffect(() => {
    if (open && active >= 0)
      document
        .getElementById(`${id}-option-${active}`)
        ?.scrollIntoView({ block: 'nearest' })
  }, [open, active, id])
  function choose(index: number) {
    onChange(matches[index]?.name ?? value.trim())
    setOpen(false)
    setActive(-1)
  }
  return (
    <div
      className="ingredient-picker"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node))
          setOpen(false)
      }}
    >
      <label htmlFor={id}>{label}</label>
      <div className="ingredient-combobox">
        <input
          id={id}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open && count > 0}
          aria-controls={`${id}-options`}
          aria-activedescendant={
            open && active >= 0 ? `${id}-option-${active}` : undefined
          }
          autoComplete="off"
          required={required}
          value={value}
          maxLength={100}
          placeholder="Search or name a new ingredient"
          onFocus={() => {
            setOpen(true)
            setActive(-1)
          }}
          onChange={(event) => {
            onChange(event.target.value)
            setOpen(true)
            setActive(-1)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && open) {
              event.preventDefault()
              event.stopPropagation()
              setOpen(false)
            }
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault()
              setOpen(true)
              setActive((index) =>
                count
                  ? Math.max(
                      0,
                      Math.min(
                        count - 1,
                        index + (event.key === 'ArrowDown' ? 1 : -1),
                      ),
                    )
                  : -1,
              )
            }
            if (event.key === 'Enter') {
              event.preventDefault()
              if (active >= 0 && active < count) choose(active)
              else {
                onChange(
                  matches.find((p) => p.name.toLowerCase() === query)?.name ??
                    value.trim(),
                )
                setOpen(false)
              }
            }
          }}
        />
        {open && count > 0 && (
          <div
            id={`${id}-options`}
            className="ingredient-suggestions"
            role="listbox"
            aria-label={`${label} suggestions`}
            onMouseDown={(event) => event.preventDefault()}
          >
            {matches.map((product, index) => (
              <button
                key={product.id}
                type="button"
                role="option"
                id={`${id}-option-${index}`}
                aria-selected={active === index}
                onClick={() => choose(index)}
              >
                <FoodIcon
                  value={product.icon}
                  image={product.image}
                  productId={product.id}
                  name={product.name}
                />
                <span>
                  <strong>{product.name}</strong>
                  <small>{product.category}</small>
                </span>
              </button>
            ))}
            {create && (
              <button
                type="button"
                role="option"
                id={`${id}-option-${matches.length}`}
                aria-selected={active === matches.length}
                onClick={() => choose(matches.length)}
              >
                <Plus size={22} />
                <span>Add new ingredient “{value.trim()}”</span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
