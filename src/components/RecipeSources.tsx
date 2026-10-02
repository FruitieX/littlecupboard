import { ExternalLink, X } from 'lucide-react'
import type { SourceImage } from '../lib/api/SourceImage'

export function RecipeSources({
  sources,
  onChange,
}: {
  sources?: SourceImage[]
  onChange?: (sources: SourceImage[]) => void
}) {
  if (!sources?.length) return null
  return (
    <details className="recipe-sources">
      <summary>Source images ({sources.length})</summary>
      <div className="recipe-source-grid">
        {sources.map((source, index) => (
          <div className="recipe-source" key={source.url}>
            <a
              href={source.url}
              target="_blank"
              rel="noreferrer"
              aria-label={`Open source image ${index + 1}: ${source.name}`}
            >
              <img src={source.url} alt={source.name} loading="lazy" />
              <span>
                {source.name}
                <ExternalLink size={14} />
              </span>
            </a>
            {onChange && (
              <button
                className="icon-button"
                type="button"
                aria-label={`Remove source image ${index + 1}`}
                onClick={() => onChange(sources.filter((_, i) => i !== index))}
              >
                <X size={16} />
              </button>
            )}
          </div>
        ))}
      </div>
    </details>
  )
}
