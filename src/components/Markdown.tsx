import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

/** Render household/AI text without HTML, embedded images, or unsafe links. */
export function Markdown({
  children,
  compact = false,
}: {
  children: string
  compact?: boolean
}) {
  const text = compact
    ? (children
        .split('\n')
        .find((line) => line.trim())
        ?.slice(0, 240) ?? '')
    : children
  return (
    <div className={`markdown ${compact ? 'markdown-summary' : ''}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        disallowedElements={['img']}
        components={{
          a: ({ children, href }) =>
            compact ? (
              <span>{children}</span>
            ) : (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            ),
          table: ({ children }) => (
            <div className="markdown-table">
              <table>{children}</table>
            </div>
          ),
          h1: ({ children }) => <h3>{children}</h3>,
          h2: ({ children }) => <h3>{children}</h3>,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}
