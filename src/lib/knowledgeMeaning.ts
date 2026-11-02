import {
  KNOWLEDGE_SEARCH_FORMAT,
  blendKnowledgeSearch,
  effectiveKnowledgePage,
  knowledgeMeaningScores,
  knowledgeQueryTerms,
  quantizeKnowledgeVector,
} from './organisationKnowledge.mjs'
import type { GuidanceFilter } from './knowledgeGuidance'
import { guidancePriority, matchesGuidanceFilter } from './knowledgeGuidance'
import type { KnowledgePage, KnowledgeStore } from './knowledgeTypes'

/**
 * The search index: for each page, its passages as vectors from a model on this computer. It lives in the package, so
 * it survives restarts and travels with the library; it can always be rebuilt from the pages. Passages are kept by a
 * hash of their text, so an edit embeds only the passages it changed.
 */

export interface KnowledgeSearchChunk {
  /** Hash of the text the model read. */
  h: string
  /** Where the passage sits in the page body. */
  at: number
  end: number
}
export interface KnowledgeSearchEntry {
  chunks: KnowledgeSearchChunk[]
  /** Base64 of one signed byte per dimension, chunk after chunk. */
  vectors: string
}
export interface KnowledgeSearchIndex {
  format: typeof KNOWLEDGE_SEARCH_FORMAT
  version: 1
  modelId: string
  dimensions: number
  /** By page id; `<id>#draft` holds working text that differs from what is published. */
  pages: Record<string, KnowledgeSearchEntry>
}
export type KnowledgeEmbedPassages = (texts: string[]) => Promise<number[][]>

export function emptyKnowledgeSearchIndex(modelId: string, dimensions: number): KnowledgeSearchIndex {
  return { format: KNOWLEDGE_SEARCH_FORMAT, version: 1, modelId, dimensions, pages: {} }
}
export function serializeKnowledgeSearchIndex(index: KnowledgeSearchIndex): string {
  return JSON.stringify(index)
}
/** The saved index if it is one this model can use; anything else starts again, and damaged pages are read afresh. */
export function parseKnowledgeSearchIndex(raw: string | null, modelId: string, dimensions: number): KnowledgeSearchIndex {
  const empty = emptyKnowledgeSearchIndex(modelId, dimensions)
  if (!raw) return empty
  let parsed: Partial<KnowledgeSearchIndex>
  try {
    parsed = JSON.parse(raw)
  } catch {
    return empty
  }
  if (parsed.format !== KNOWLEDGE_SEARCH_FORMAT || parsed.version !== 1 || parsed.modelId !== modelId || parsed.dimensions !== dimensions || !parsed.pages || typeof parsed.pages !== 'object') return empty
  const pages: Record<string, KnowledgeSearchEntry> = {}
  for (const [key, entry] of Object.entries(parsed.pages)) {
    const bytes = Array.isArray(entry?.chunks) ? entry.chunks.length * dimensions : -1
    if (typeof entry?.vectors === 'string' && entry.vectors.length === Math.ceil(bytes / 3) * 4) pages[key] = entry
  }
  return { ...empty, pages }
}

// ---- Passages -------------------------------------------------------------------------------------------------------

const MAX_WORDS = 170
const OPENING_WORDS = 50
const MAX_CHUNK_CHARS = 2_000

function cleanForReading(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/data:[a-z/+.-]+;base64,[A-Za-z0-9+/=]+/gi, ' ')
    .replace(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`/g, '')
    .replace(/[|*#>]+/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim()
}
function hashText(text: string): string {
  let a = 0xdeadbeef, b = 0x41c6ce57
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    a = Math.imul(a ^ code, 2654435761)
    b = Math.imul(b ^ code, 1597334677)
  }
  a = Math.imul(a ^ (a >>> 16), 2246822507) ^ Math.imul(b ^ (b >>> 13), 3266489909)
  b = Math.imul(b ^ (b >>> 16), 2246822507) ^ Math.imul(a ^ (a >>> 13), 3266489909)
  return (4294967296 * (2097151 & b) + (a >>> 0)).toString(36)
}

export interface KnowledgePassage {
  text: string
  hash: string
  at: number
  end: number
}
const passagesByPage = new WeakMap<KnowledgePage, KnowledgePassage[]>()
/**
 * Passages start at headings and paragraphs, so an edit leaves the rest of the page's passages unchanged. The first
 * one carries the title, aliases and tags; each carries its title and heading, so it still makes sense alone.
 */
export function knowledgePagePassages(page: KnowledgePage): KnowledgePassage[] {
  const known = passagesByPage.get(page)
  if (known) return known
  const made: Array<{ text: string; at: number; end: number }> = []
  const head = `${page.title}${page.aliases?.length ? ` (${page.aliases.join(', ')})` : ''}${page.tags.length ? ` — ${page.tags.join(', ')}` : ''}`
  const opening: string[] = []
  let heading = ''
  let lines: string[] = []
  let words = 0
  let start = 0
  let lineEnd = 0
  const context = () => `${page.title}${heading ? ` — ${heading}` : ''}`
  const flush = () => {
    if (lines.length) made.push({ text: `${context()}\n${lines.join('\n')}`, at: start, end: lineEnd })
    lines = []
    words = 0
  }
  let offset = 0
  for (const raw of page.body.split('\n')) {
    const lineStart = offset
    offset += raw.length + 1
    const title = /^#{1,6}\s+(.+)$/.exec(raw)
    if (title) {
      flush()
      heading = cleanForReading(title[1])
      continue
    }
    const text = cleanForReading(raw)
    if (!text) continue
    const tokens = text.split(/\s+/)
    if (opening.length < OPENING_WORDS) opening.push(...tokens.slice(0, OPENING_WORDS - opening.length))
    if (tokens.length > MAX_WORDS) {
      flush()
      for (let i = 0; i < tokens.length; i += MAX_WORDS) {
        made.push({
          text: `${context()}\n${tokens.slice(i, i + MAX_WORDS).join(' ')}`,
          at: lineStart + Math.floor((i / tokens.length) * raw.length),
          end: lineStart + Math.floor((Math.min(tokens.length, i + MAX_WORDS) / tokens.length) * raw.length),
        })
      }
      continue
    }
    if (words + tokens.length > MAX_WORDS) flush()
    if (!lines.length) start = lineStart
    lines.push(text)
    words += tokens.length
    lineEnd = lineStart + raw.length
  }
  flush()
  const passages = [{ text: `${head}\n${opening.join(' ')}`, at: 0, end: Math.min(page.body.length, 400) }, ...made].map(passage => {
    const text = passage.text.slice(0, MAX_CHUNK_CHARS)
    return { ...passage, text, hash: hashText(text) }
  })
  passagesByPage.set(page, passages)
  return passages
}

/** What the index holds for a set of pages: the published text, and working text where that differs. */
export function indexableKnowledgePages(pages: readonly KnowledgePage[]): Array<{ key: string; page: KnowledgePage }> {
  const out: Array<{ key: string; page: KnowledgePage }> = []
  for (const page of pages) {
    let live: KnowledgePage | null = null
    try {
      live = effectiveKnowledgePage(page, false)
    } catch {
      // A damaged publication still has working text to find; a repair in the app restores the rest.
    }
    if (live) out.push({ key: page.id, page: live })
    if (!live || live.body !== page.body || live.title !== page.title) out.push({ key: `${page.id}#draft`, page })
  }
  return out
}

// ---- Keeping it current ---------------------------------------------------------------------------------------------

function toBase64(bytes: Int8Array): string {
  let text = ''
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...new Uint8Array(bytes.buffer, bytes.byteOffset + i, Math.min(0x8000, bytes.length - i)))
  return btoa(text)
}
function fromBase64(text: string): Int8Array {
  const raw = atob(text)
  const bytes = new Int8Array(raw.length)
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return bytes
}
function sameChunks(entry: KnowledgeSearchEntry, passages: readonly KnowledgePassage[]): boolean {
  return entry.chunks.length === passages.length && entry.chunks.every((chunk, i) => chunk.h === passages[i].hash && chunk.at === passages[i].at && chunk.end === passages[i].end)
}

export interface KnowledgeSearchPlan {
  /** Pages with a passage to read or one that moved. */
  work: Array<{ key: string; page: KnowledgePage; passages: KnowledgePassage[]; missing: KnowledgePassage[] }>
  removed: string[]
  totalPassages: number
  missingPassages: number
}
export function planKnowledgeSearchUpdate(index: KnowledgeSearchIndex, pages: readonly KnowledgePage[]): KnowledgeSearchPlan {
  const wanted = indexableKnowledgePages(pages)
  const keys = new Set(wanted.map(item => item.key))
  const plan: KnowledgeSearchPlan = { work: [], removed: Object.keys(index.pages).filter(key => !keys.has(key)), totalPassages: 0, missingPassages: 0 }
  for (const { key, page } of wanted) {
    const passages = knowledgePagePassages(page)
    plan.totalPassages += passages.length
    const entry = index.pages[key]
    if (entry && sameChunks(entry, passages)) continue
    const have = new Set(entry?.chunks.map(chunk => chunk.h))
    const missing = passages.filter(passage => !have.has(passage.hash))
    plan.missingPassages += missing.length
    plan.work.push({ key, page, passages, missing })
  }
  return plan
}

export interface KnowledgeSearchUpdateOptions {
  batchSize?: number
  /** After each page: the index so far, usable and worth saving. */
  onProgress?: (index: KnowledgeSearchIndex, done: { embedded: number; total: number }) => void | Promise<void>
  shouldStop?: () => boolean
}
export interface KnowledgeSearchUpdateResult {
  index: KnowledgeSearchIndex
  embedded: number
  reused: number
  removed: number
  stopped: boolean
}
/** Reads only what changed. A failure leaves every finished page in the index, and the error reaches the caller. */
export async function updateKnowledgeSearchIndex(
  index: KnowledgeSearchIndex,
  pages: readonly KnowledgePage[],
  embed: KnowledgeEmbedPassages,
  options: KnowledgeSearchUpdateOptions = {},
): Promise<KnowledgeSearchUpdateResult> {
  const plan = planKnowledgeSearchUpdate(index, pages)
  // Small enough that a question arriving now waits about a quarter of a second, not more.
  const batchSize = options.batchSize ?? 4
  const { dimensions } = index
  let current = index
  if (plan.removed.length) {
    const kept = { ...current.pages }
    for (const key of plan.removed) delete kept[key]
    current = { ...current, pages: kept }
  }
  let embedded = 0
  let reused = 0
  for (const item of plan.work) {
    if (options.shouldStop?.()) return { index: current, embedded, reused, removed: plan.removed.length, stopped: true }
    const fresh = new Map<string, Int8Array>()
    for (let i = 0; i < item.missing.length; i += batchSize) {
      const batch = item.missing.slice(i, i + batchSize)
      const vectors = await embed(batch.map(passage => passage.text))
      if (vectors.length !== batch.length) throw new Error('The search model returned the wrong number of vectors')
      batch.forEach((passage, at) => {
        if (vectors[at].length !== dimensions) throw new Error('The search model returned a vector of the wrong length')
        fresh.set(passage.hash, quantizeKnowledgeVector(vectors[at]))
      })
      embedded += batch.length
    }
    const previous = current.pages[item.key]
    const previousVectors = previous ? fromBase64(previous.vectors) : new Int8Array(0)
    const reusable = new Map(previous?.chunks.map((chunk, i) => [chunk.h, previousVectors.subarray(i * dimensions, (i + 1) * dimensions)]))
    const bytes = new Int8Array(item.passages.length * dimensions)
    item.passages.forEach((passage, i) => {
      const vector = fresh.get(passage.hash) ?? reusable.get(passage.hash)
      if (!vector) throw new Error('A passage was left unread')
      if (!fresh.has(passage.hash)) reused += 1
      bytes.set(vector, i * dimensions)
    })
    current = {
      ...current,
      pages: {
        ...current.pages,
        [item.key]: { chunks: item.passages.map(({ hash, at, end }) => ({ h: hash, at, end })), vectors: toBase64(bytes) },
      },
    }
    await options.onProgress?.(current, { embedded, total: plan.missingPassages })
  }
  return { index: current, embedded, reused, removed: plan.removed.length, stopped: false }
}

// ---- Searching ------------------------------------------------------------------------------------------------------

export type KnowledgeSearchMatch = 'words' | 'meaning' | 'both'
export interface KnowledgeMeaningHit {
  page: KnowledgePage
  score: number
  matched: KnowledgeSearchMatch
  snippet: string
}
function passageSnippet(page: KnowledgePage, at: number, end: number): string {
  const text = page.body.slice(at, Math.min(end, at + 600))
  return cleanForReading(text).replace(/\s+/g, ' ').slice(0, 180)
}
function wordSnippet(page: KnowledgePage, query: string): string {
  const body = page.body.replace(/\s+/g, ' ').trim()
  const lowered = body.toLocaleLowerCase()
  const at = knowledgeQueryTerms(query).map(term => lowered.indexOf(term)).filter(position => position !== -1).sort((a, b) => a - b)[0]
  if (at === undefined) return body.slice(0, 160)
  const start = Math.max(0, at - 60)
  return `${start > 0 ? '…' : ''}${body.slice(start, start + 180)}`
}
/**
 * The one ranking with meaning, used by the search box and the agent tool. Current guidance still leads its results,
 * except that a page named exactly comes first unless it is retired.
 */
export function rankKnowledgeWithMeaning(
  store: KnowledgeStore,
  query: string,
  limit: number,
  status: GuidanceFilter | undefined,
  index: KnowledgeSearchIndex,
  queryVector: readonly number[],
  options: { drafts?: boolean } = {},
): KnowledgeMeaningHit[] {
  const pages = store.pages.filter(page => matchesGuidanceFilter(page, status ?? 'all'))
  const scores = knowledgeMeaningScores(index, queryVector, pages, { drafts: options.drafts === true })
  const lead = (hit: { exact: boolean; page: KnowledgePage }) => (hit.exact && hit.page.guidanceStatus !== 'retired' ? -1 : guidancePriority(hit.page))
  return blendKnowledgeSearch(pages, query, scores)
    .sort((a, b) => lead(a) - lead(b) || b.score - a.score)
    .slice(0, limit)
    .map(hit => ({
      page: hit.page,
      score: hit.score,
      matched: hit.matched,
      snippet: hit.at !== undefined && hit.end !== undefined && hit.matched === 'meaning' ? passageSnippet(hit.page, hit.at, hit.end) : wordSnippet(hit.page, query),
    }))
}

/** Too short to mean anything yet: while someone is still typing a word, words are the right answer. */
export const MEANING_MIN_QUERY = 3

// ---- What search can do right now ---------------------------------------------------------------------------------

export type KnowledgeMeaningState = 'checking' | 'unsupported' | 'absent' | 'downloading' | 'failed' | 'indexing' | 'ready'
export interface KnowledgeMeaningReadiness {
  state: KnowledgeMeaningState
  /** Size of the download, for the offer to set it up. */
  totalBytes?: number
  receivedBytes?: number
  /** Passages read and still to read. */
  indexed?: number
  total?: number
  error?: string
}
/** What the rest of the app needs from search by meaning (hooks/useKnowledgeMeaning). */
export interface KnowledgeMeaning {
  readiness(): KnowledgeMeaningReadiness
  index(): KnowledgeSearchIndex | null
  /** Null when search by meaning cannot answer right now. */
  vector(query: string): Promise<number[] | null>
}
/** The plain sentence for a person or an agent, whenever a search is not fully by meaning. Null when it is. */
export function meaningSearchNote(readiness: KnowledgeMeaningReadiness): string | null {
  switch (readiness.state) {
    case 'ready':
      return null
    case 'indexing':
      return `Still reading pages for search by meaning (${readiness.indexed ?? 0} of ${readiness.total ?? 0} passages). Pages not read yet are matched by their exact words only.`
    case 'downloading':
      return 'The search model is still downloading, so this searched exact words only.'
    case 'failed':
      return `Search by meaning stopped working, so this searched exact words only.${readiness.error ? ` ${readiness.error}` : ''}`
    case 'unsupported':
      return 'This desktop cannot search by meaning, so this searched exact words only.'
    case 'checking':
      return 'Search by meaning is still starting, so this searched exact words only.'
    case 'absent':
      return 'Search by meaning is not set up on this computer, so this searched exact words only.'
  }
}
