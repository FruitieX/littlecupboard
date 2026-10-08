import { useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import { History, Plus, Search } from 'lucide-react'
import type { AppState, Product } from '../lib/data'
import { rankProducts, splitVariants } from '../lib/shopping'
import { FoodIcon } from './FoodIcon'

/**
 * The "What do we need?" box: ranked suggestions, known items with the extra
 * words as a note ("peppermint tea" → Tea), and "Create …" for new items.
 * Shopping adds picks to the list; the cupboard records them as at home.
 */
export function ItemSearch({
  id,
  state,
  products,
  label,
  submitLabel,
  placeholder,
  score = () => 0,
  idle = [],
  idleCaption = '',
  describe,
  onPick,
  onCreate,
  createHint = 'Choose a group and add details',
  inputRef,
  children,
  after,
  className = '',
}: {
  /** Prefix for element ids, unique per page. */
  id: string
  state: AppState
  products: Product[]
  label: string
  submitLabel: string
  placeholder: string
  score?: (id: string) => number
  /** Suggestions while the box is empty. */
  idle?: Product[]
  idleCaption?: string
  describe: (product: Product) => string
  onPick: (product: Product, note?: string) => void
  /** Called with the typed name, or '' when submitted empty. */
  onCreate: (name: string) => void
  createHint?: string
  inputRef?: RefObject<HTMLInputElement | null>
  /** Extra buttons inside the box, before the add button. */
  children?: ReactNode
  /** Rendered between the box and its suggestions. */
  after?: ReactNode
  className?: string
}) {
  const ownInput = useRef<HTMLInputElement>(null)
  const input = inputRef ?? ownInput
  const [query, setQuery] = useState('')
  const [isFocused, setFocused] = useState(false)
  const [suggestionIndex, setSuggestionIndex] = useState(-1)
  const trimmed = query.trim()
  const suggestions = trimmed
    ? rankProducts(products, trimmed, score).slice(0, 6)
    : idle.slice(0, 6)
  const canCreate =
    !!trimmed &&
    !products.some((p) => p.name.toLowerCase() === trimmed.toLowerCase())
  // "peppermint tea" also offers the existing Tea with a note.
  const variants = canCreate ? splitVariants(products, trimmed) : []
  const createIndex = suggestions.length + variants.length
  const optionCount = createIndex + Number(canCreate)
  const listOpen = isFocused && optionCount > 0
  const listId = `${id}-suggestions`
  const optionId = (index: number) => `${id}-suggestion-${index}`

  function reset() {
    setQuery('')
    setSuggestionIndex(-1)
  }
  function pick(product: Product, note?: string) {
    onPick(product, note)
    reset()
    input.current?.focus()
  }
  function create() {
    onCreate(trimmed)
    reset()
  }
  const option = (
    index: number,
    key: string,
    product: Product,
    detail: string,
    note?: string,
  ) => (
    <button
      key={key}
      type="button"
      id={optionId(index)}
      role="option"
      aria-selected={suggestionIndex === index}
      onClick={() => pick(product, note)}
    >
      <span className="suggestion-icon">
        <FoodIcon
          image={state.productImages?.[product.id] || product.image}
          value={product.icon}
          productId={product.id}
          name={product.name}
        />
      </span>
      <span>
        <strong>{product.name}</strong>
        <small>{detail}</small>
      </span>
      <Plus size={18} />
    </button>
  )

  return (
    <div
      className={`add-item-wrap ${className}`}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node))
          setFocused(false)
      }}
    >
      <form
        className="add-item"
        onSubmit={(e) => {
          e.preventDefault()
          const exact = products.find(
            (p) => p.name.toLowerCase() === trimmed.toLowerCase(),
          )
          if (exact) pick(exact)
          // An empty box opens the dialog to type or snap a photo.
          else create()
        }}
      >
        <Search size={21} />
        <input
          ref={input}
          aria-label={label}
          role="combobox"
          aria-expanded={listOpen}
          aria-controls={listId}
          aria-activedescendant={
            listOpen && suggestionIndex >= 0
              ? optionId(suggestionIndex)
              : undefined
          }
          autoComplete="off"
          placeholder={placeholder}
          value={query}
          onFocus={() => setFocused(true)}
          onChange={(e) => {
            setQuery(e.target.value)
            setFocused(true)
            setSuggestionIndex(-1)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setFocused(false)
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault()
              setFocused(true)
              setSuggestionIndex((i) =>
                Math.max(
                  0,
                  Math.min(
                    optionCount - 1,
                    i + (e.key === 'ArrowDown' ? 1 : -1),
                  ),
                ),
              )
            }
            if (e.key === 'Enter' && listOpen && suggestionIndex >= 0) {
              e.preventDefault()
              if (suggestionIndex < suggestions.length)
                pick(suggestions[suggestionIndex])
              else if (suggestionIndex < createIndex) {
                const variant = variants[suggestionIndex - suggestions.length]
                pick(variant.product, variant.note)
              } else create()
            }
          }}
        />
        {children}
        <button type="submit" className="add-submit" aria-label={submitLabel}>
          <Plus size={22} />
        </button>
      </form>
      {after}
      {listOpen && (
        <div
          className="suggestions"
          id={listId}
          role="listbox"
          aria-label={trimmed ? 'Product suggestions' : idleCaption}
          onMouseDown={(e) => e.preventDefault()}
        >
          {!trimmed && idleCaption && (
            <p className="suggestions-caption" aria-hidden="true">
              <History size={13} /> {idleCaption}
            </p>
          )}
          {suggestions.map((p, index) => option(index, p.id, p, describe(p)))}
          {variants.map((variant, offset) =>
            option(
              suggestions.length + offset,
              `variant-${variant.product.id}`,
              variant.product,
              `Note: ${variant.note}`,
              variant.note,
            ),
          )}
          {canCreate && (
            <button
              type="button"
              id={optionId(createIndex)}
              role="option"
              aria-selected={suggestionIndex === createIndex}
              onClick={create}
            >
              <span className="suggestion-icon">
                <FoodIcon value="✨" />
              </span>
              <span>
                <strong>Create “{trimmed}”</strong>
                <small>{createHint}</small>
              </span>
              <Plus size={18} />
            </button>
          )}
        </div>
      )}
    </div>
  )
}
