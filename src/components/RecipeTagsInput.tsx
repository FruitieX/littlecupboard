import { useEffect, useId, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { normalizeTags } from '../lib/recipe-tags'

export function RecipeTagsInput({
  value,
  onChange,
  options,
}: {
  value: string
  onChange: (value: string) => void
  options: string[]
}) {
  const id = useId()
  const input = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const parts = value.split(',')
  const query = parts.at(-1)?.trim() ?? ''
  const used = normalizeTags(parts.slice(0, -1))
  const matches = options
    .filter(
      (tag) =>
        tag.toLowerCase().includes(query.toLowerCase()) &&
        !used.some((selected) => selected.toLowerCase() === tag.toLowerCase()),
    )
    .slice(0, 8)
  const create =
    query &&
    !options.some((tag) => tag.toLowerCase() === query.toLowerCase()) &&
    !used.some((tag) => tag.toLowerCase() === query.toLowerCase())
  const choices = [...matches, ...(create ? [query] : [])]
  useEffect(() => {
    if (open && active >= 0)
      document
        .getElementById(`${id}-option-${active}`)
        ?.scrollIntoView({ block: 'nearest' })
  }, [open, active, id])
  function choose(tag: string) {
    onChange(
      normalizeTags([...parts.slice(0, -1), tag], options).join(', ') + ', ',
    )
    setActive(-1)
    setOpen(false)
    input.current?.focus()
  }
  return (
    <div
      className="recipe-tags-field"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node))
          setOpen(false)
      }}
    >
      <label htmlFor={id}>Tags</label>
      <div className="recipe-tags-combobox">
        <input
          id={id}
          ref={input}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open && !!choices.length}
          aria-controls={`${id}-options`}
          aria-activedescendant={
            open && active >= 0 && active < choices.length
              ? `${id}-option-${active}`
              : undefined
          }
          autoComplete="off"
          value={value}
          maxLength={500}
          placeholder="Choose or create tags, separated by commas"
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
                choices.length
                  ? Math.max(
                      0,
                      Math.min(
                        choices.length - 1,
                        index + (event.key === 'ArrowDown' ? 1 : -1),
                      ),
                    )
                  : -1,
              )
            }
            if (event.key === 'Enter') {
              event.preventDefault()
              const selected =
                choices[active] ??
                (query
                  ? (matches.find(
                      (tag) => tag.toLowerCase() === query.toLowerCase(),
                    ) ?? (matches.length === 1 ? matches[0] : query))
                  : undefined)
              if (selected) choose(selected)
              else setOpen(false)
            }
          }}
        />
        {open && !!choices.length && (
          <div
            className="recipe-tag-suggestions"
            id={`${id}-options`}
            role="listbox"
            aria-label="Recipe tag suggestions"
            onMouseDown={(event) => event.preventDefault()}
          >
            {choices.map((tag, index) => (
              <button
                key={tag.toLowerCase()}
                type="button"
                role="option"
                id={`${id}-option-${index}`}
                aria-selected={active === index}
                onClick={() => choose(tag)}
              >
                {index >= matches.length ? `Create “${tag}”` : tag}
              </button>
            ))}
          </div>
        )}
      </div>
      {!!normalizeTags(value).length && (
        <div className="recipe-tag-preview">
          {normalizeTags(value, options).map((tag) => (
            <span key={tag.toLowerCase()} className="recipe-tag">
              {tag}
              <button
                type="button"
                aria-label={`Remove tag ${tag}`}
                onClick={() =>
                  onChange(
                    normalizeTags(value, options)
                      .filter((value) => value !== tag)
                      .join(', '),
                  )
                }
              >
                <X size={13} />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
