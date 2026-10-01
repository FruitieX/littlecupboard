import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { Markdown } from './Markdown'

describe('recipe markdown', () => {
  it('renders notes, lists, tables and formatting while excluding active content', () => {
    const html = renderToStaticMarkup(
      <Markdown>{`## Notes\n\n**Keep chilled** and *serve fresh*.\n\n- Use ripe pears\n- Stir gently\n\n| Option | Amount |\n| --- | --- |\n| Oats | 80 g |\n\n[Source](https://example.test/recipe)\n\n[unsafe](javascript:alert%281%29)\n\n<script>alert(1)</script>\n\n![tracking](https://example.test/pixel.png)`}</Markdown>,
    )
    expect(html).toContain('<strong>Keep chilled</strong>')
    expect(html).toContain('<li>Use ripe pears</li>')
    expect(html).toContain('<table>')
    expect(html).toContain('rel="noopener noreferrer"')
    expect(html).not.toContain('href="javascript:')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('<img')
  })
})
