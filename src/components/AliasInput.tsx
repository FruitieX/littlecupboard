import { X } from 'lucide-react'

/**
 * Alternate names as removable chips. Enter or a comma adds the typed name;
 * text still in the box is saved too, so nobody needs to know a separator.
 */
export function AliasInput({
  aliases,
  onChange,
  draft,
  onDraftChange,
}: {
  aliases: string[]
  onChange: (aliases: string[]) => void
  draft: string
  onDraftChange: (draft: string) => void
}) {
  function commit(text = draft) {
    const names = text
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean)
    const next = [...aliases]
    for (const name of names)
      if (!next.some((alias) => alias.toLowerCase() === name.toLowerCase()))
        next.push(name.slice(0, 80))
    if (next.length !== aliases.length) onChange(next.slice(0, 30))
    onDraftChange('')
  }
  return (
    <div className="alias-input">
      <span className="alias-label" id="alias-label">
        Other names <span className="optional">optional</span>
      </span>
      <small className="alias-help">
        Names people might type when adding this item, like “spuds” for
        potatoes.
      </small>
      {aliases.length > 0 && (
        <ul className="alias-chips" aria-label="Other names">
          {aliases.map((alias) => (
            <li key={alias}>
              {alias}
              <button
                type="button"
                aria-label={`Remove ${alias}`}
                onClick={() =>
                  onChange(aliases.filter((entry) => entry !== alias))
                }
              >
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="alias-entry">
        <input
          aria-label="Search aliases"
          aria-describedby="alias-label"
          value={draft}
          maxLength={200}
          enterKeyHint="done"
          placeholder={aliases.length ? 'Add another name' : 'Add a name'}
          onChange={(event) => {
            const value = event.target.value
            if (value.includes(',')) commit(value)
            else onDraftChange(value)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              commit()
            } else if (event.key === 'Backspace' && !draft && aliases.length)
              onChange(aliases.slice(0, -1))
          }}
          onBlur={() => commit()}
        />
        <button
          type="button"
          className="secondary-button"
          disabled={!draft.trim()}
          onClick={() => commit()}
        >
          Add
        </button>
      </div>
    </div>
  )
}
