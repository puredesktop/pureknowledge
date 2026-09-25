/**
 * Page-per-file storage for the .knowledge package.
 *
 *   <name>.knowledge/
 *     manifest.json     — unchanged package manifest
 *     index.json        — spaces, active ids, schema marker
 *     pages/<slug>-<id8>.md — one page per file: JSON frontmatter + body
 *     activity.json     — capped feed (the operations ledger is the archive)
 *     proposals.json    — agent-change queue (reviewed history capped)
 *
 * An edit writes one small page file plus whichever side files changed —
 * never the whole knowledge base. Corruption costs one page. Bodies are
 * plain markdown on disk: greppable, diffable, backupable per page.
 */
import type {
  KnowledgeActivity,
  KnowledgeAgentChange,
  KnowledgePage,
  KnowledgeSpace,
  KnowledgeStore,
} from './knowledgeTypes'

export const KNOWLEDGE_PAGES_DIR = 'pages'
export const KNOWLEDGE_INDEX_FILE = 'index.json'
export const KNOWLEDGE_ACTIVITY_FILE = 'activity.json'
export const KNOWLEDGE_PROPOSALS_FILE = 'proposals.json'

/** The feed stays a feed: recent history, not an archive. */
export const KNOWLEDGE_ACTIVITY_CAP = 500
export const KNOWLEDGE_REVIEWED_PROPOSALS_CAP = 100

const FRONTMATTER_OPEN = '---\n'
const FRONTMATTER_CLOSE = '\n---\n'

export interface KnowledgeIndexFile {
  schemaVersion: 2
  activeSpaceId: string | null
  activePageId: string | null
  spaces: KnowledgeSpace[]
}

type PageMeta = Omit<KnowledgePage, 'body'>

/** Stable at creation: readable slug prefix, unique id suffix, never renamed. */
export function pageFileName(page: KnowledgePage): string {
  const slug = (page.slug || 'page')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  const suffix = page.id.replace(/[^a-zA-Z0-9]/g, '').slice(-8) || 'x'
  return `${slug || 'page'}-${suffix}.md`
}

export function serializePageFile(page: KnowledgePage): string {
  const { body, ...meta } = page
  return `${FRONTMATTER_OPEN}${JSON.stringify(meta, null, 2)}${FRONTMATTER_CLOSE}${body}`
}

export function parsePageFile(raw: string): KnowledgePage | null {
  if (!raw.startsWith(FRONTMATTER_OPEN)) return null
  const close = raw.indexOf(FRONTMATTER_CLOSE, FRONTMATTER_OPEN.length)
  if (close === -1) return null
  try {
    const meta = JSON.parse(
      raw.slice(FRONTMATTER_OPEN.length, close),
    ) as PageMeta
    if (typeof meta.id !== 'string' || typeof meta.spaceId !== 'string') {
      return null
    }
    const body = raw.slice(close + FRONTMATTER_CLOSE.length)
    return { ...meta, body }
  } catch {
    return null
  }
}

export function serializeKnowledgeIndex(store: KnowledgeStore): string {
  const index: KnowledgeIndexFile = {
    schemaVersion: 2,
    activeSpaceId: store.activeSpaceId ?? null,
    activePageId: store.activePageId ?? null,
    spaces: store.spaces,
  }
  return JSON.stringify(index, null, 2)
}

export function serializeKnowledgeActivity(
  activity: KnowledgeActivity[],
): string {
  return JSON.stringify(activity.slice(0, KNOWLEDGE_ACTIVITY_CAP), null, 2)
}

export function serializeKnowledgeProposals(
  changes: KnowledgeAgentChange[],
): string {
  const pending = changes.filter(change => change.status === 'pending')
  const reviewed = changes
    .filter(change => change.status !== 'pending')
    .slice(0, KNOWLEDGE_REVIEWED_PROPOSALS_CAP)
  return JSON.stringify([...pending, ...reviewed], null, 2)
}

export function assembleKnowledgeStore(
  index: KnowledgeIndexFile,
  pages: KnowledgePage[],
  activity: KnowledgeActivity[],
  proposals: KnowledgeAgentChange[],
): KnowledgeStore {
  return {
    schemaVersion: 1,
    spaces: index.spaces,
    pages,
    activity,
    agentChanges: proposals,
    activeSpaceId: index.activeSpaceId ?? '',
    activePageId: index.activePageId,
  }
}

export interface KnowledgePageWritePlan {
  /** Page files to write (added or changed). */
  writes: Array<{ fileName: string; content: string }>
  /** Page files to delete (page removed). */
  deletes: string[]
  indexChanged: boolean
  activityChanged: boolean
  proposalsChanged: boolean
}

/**
 * Diff two stores into the minimal set of file operations. Reference
 * equality is enough: the store is immutable, so an untouched page is the
 * same object.
 */
export function planKnowledgeWrites(
  previous: KnowledgeStore | null,
  next: KnowledgeStore,
): KnowledgePageWritePlan {
  const prevById = new Map(
    (previous?.pages ?? []).map(page => [page.id, page]),
  )
  const nextIds = new Set(next.pages.map(page => page.id))
  const writes: Array<{ fileName: string; content: string }> = []
  for (const page of next.pages) {
    const before = prevById.get(page.id)
    if (before !== page) {
      writes.push({
        fileName: pageFileName(page),
        content: serializePageFile(page),
      })
    }
  }
  const deletes: string[] = []
  for (const [id, page] of prevById) {
    if (!nextIds.has(id)) deletes.push(pageFileName(page))
  }
  return {
    writes,
    deletes,
    indexChanged:
      !previous ||
      previous.spaces !== next.spaces ||
      previous.activeSpaceId !== next.activeSpaceId ||
      previous.activePageId !== next.activePageId,
    activityChanged: !previous || previous.activity !== next.activity,
    proposalsChanged:
      !previous || (previous.agentChanges ?? []) !== (next.agentChanges ?? []),
  }
}
