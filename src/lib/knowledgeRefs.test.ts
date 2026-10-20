import { describe, expect, it } from 'vitest'
import { linkKnowledgeRefs, pageForRef } from './knowledgeRefs'

const pages = [
  { id: 'page-db210d47-ca3c-4a34-9391-725382e36d88' },
  { id: 'page-4f45c761-1097-40a3-849b-ce4520e4faf0' },
]

describe('knowledge refs', () => {
  it('finds a page by its id, a cut-short id, or its file', () => {
    expect(pageForRef('page-db210d47-ca3c-4a34-9391-725382e36d88', pages)?.id).toBe(pages[0]!.id)
    expect(pageForRef('page-4f45c761-…', pages)?.id).toBe(pages[1]!.id)
    expect(pageForRef('pages/adam-hyde-biography-and-career-82e36d88.md', pages)?.id).toBe(pages[0]!.id)
    expect(pageForRef('page-00000000-0000-0000-0000-000000000000', pages)).toBeNull()
    expect(pageForRef('getKnowledgeContext', pages)).toBeNull()
  })

  it('links code that names a page or a path, and nothing else', () => {
    const html = '<p><code>page-4f45c761-…</code> in <code>/Users/adam/knowledge.knowledge</code>, via <code>listSpaces</code></p>'
    const out = linkKnowledgeRefs(html, pages)
    expect(out).toContain(`data-knowledge-page="${pages[1]!.id}"`)
    expect(out).toContain('data-knowledge-path="/Users/adam/knowledge.knowledge"')
    expect(out).toContain('<code>listSpaces</code>')
    expect(out).not.toMatch(/<a[^>]*><code>listSpaces/)
  })

  it('leaves code blocks and existing links alone', () => {
    const html = '<pre><code>page-4f45c761-…</code></pre><a href="x"><code>/Users/a</code></a>'
    expect(linkKnowledgeRefs(html, pages)).toBe(html)
  })
})
