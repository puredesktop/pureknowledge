/**
 * Ids and paths in a page are links: a page id (`page-db210d47-…`, whole or cut short), a page's file
 * (`pages/adam-hyde-biography-and-career-82e36d88.md`) and a path on disk (`/Users/…/knowledge.knowledge`) written as
 * code in the page body become links to that page, or to that file in its app. Worked out from the rendered HTML and
 * the pages there are, so an agent's inventory reads as a map, not a list of strings to copy.
 */

export interface RefPage {
  id: string
}

const FULL_PAGE_ID = /^page-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SHORT_PAGE_ID = /^(page-[0-9a-f][0-9a-f-]{3,})(?:…|\.\.\.)$/i
const PAGE_FILE = /^(?:.*\/)?pages\/[^/\s]+-([0-9a-f]{8})\.md$/i
const DISK_PATH = /^(?:\/|~\/)[^\s<>"'`]+$/

const decode = (text: string): string =>
  text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
const attr = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** The page a code span names, if it names one that exists. */
export function pageForRef(text: string, pages: readonly RefPage[]): RefPage | null {
  const value = text.trim()
  if (FULL_PAGE_ID.test(value)) return pages.find(page => page.id === value) ?? null
  const short = SHORT_PAGE_ID.exec(value)?.[1]
  if (short) {
    const matches = pages.filter(page => page.id.startsWith(short))
    return matches.length === 1 ? matches[0]! : null
  }
  const suffix = PAGE_FILE.exec(value)?.[1]?.toLowerCase()
  if (suffix) {
    const matches = pages.filter(page => page.id.toLowerCase().endsWith(suffix))
    return matches.length === 1 ? matches[0]! : null
  }
  return null
}

/**
 * The rendered body with each code span that names a page or a path wrapped in a link: `data-knowledge-page` (the
 * page's id) or `data-knowledge-path`. Code blocks, and code already inside a link, are left as they are.
 */
export function linkKnowledgeRefs(html: string, pages: readonly RefPage[]): string {
  if (!html.includes('<code')) return html
  // Leave code blocks and existing links alone: only the text between them is looked at.
  return html.replace(/(<pre[\s\S]*?<\/pre>|<a\b[\s\S]*?<\/a>)|<code>([^<]{1,500})<\/code>/gi, (whole, kept: string | undefined, inner: string | undefined) => {
    if (kept || inner === undefined) return whole
    const text = decode(inner)
    const page = pageForRef(text, pages)
    if (page) return `<a href="#" class="knowledge-ref" data-knowledge-page="${attr(page.id)}" title="Open this page">${whole}</a>`
    if (DISK_PATH.test(text.trim())) return `<a href="#" class="knowledge-ref" data-knowledge-path="${attr(text.trim())}" title="Open ${attr(text.trim())}">${whole}</a>`
    return whole
  })
}
