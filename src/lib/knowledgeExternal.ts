/** Merge content written by another app instance into the local state. */
import { latestKnowledgePages, serializePageFile } from './knowledgePages'
import type { KnowledgePage, KnowledgeStore } from './knowledgeTypes'

/** Does a changed path belong to this package? */
export function isKnowledgePackageChange(
  eventPath: string,
  packagePath: string,
): boolean {
  const root = packagePath.replace(/\\/g, '/').replace(/\/+$/, '')
  eventPath = eventPath.replace(/\\/g, '/')
  if (!eventPath || !root) return false
  return eventPath === root || eventPath.startsWith(`${root}/`)
}

export interface KnowledgeExternalMergeResult {
  store: KnowledgeStore
  /**
   * Titles of pages where a NEWER local edit was kept over the disk
   * version — the "unsaved local edits" the user should be told about.
   */
  conflicts: string[]
  /** True when the merge output differs from the incoming disk state. */
  changedFromIncoming: boolean
  /** Pages whose newer local edit was kept: the next save still has to meet the disk version, so nothing is lost. */
  conflictIds: string[]
  /** Saved pages gone from disk that held unsaved words here: deleted elsewhere, so not carried on as they were. */
  deletedWithWords: KnowledgePage[]
}

function latestTimestamp(a: string | undefined, b: string | undefined): number {
  const parse = (value: string | undefined): number => {
    const parsed = value ? Date.parse(value) : Number.NaN
    return Number.isFinite(parsed) ? parsed : 0
  }
  return Math.max(parse(a), parse(b))
}

/**
 * Merge an externally re-read store into the locally held one.
 *
 * Disk wins by default — the event arrived because someone else wrote the
 * package. The exceptions protect in-flight local work:
 *   - a page both sides carry keeps the LOCAL version when its updatedAt
 *     is strictly newer than the disk copy (a not-yet-flushed edit), and
 *     that page is reported as a conflict;
 *   - a page only the local store carries is kept (a just-created page
 *     mid-save; resurrecting an outside deletion is the safe failure —
 *     content is never silently dropped).
 * With an acknowledged baseline, external deletions remove unchanged saved
 * pages while newly created or unsaved pages remain protected.
 * Selection (active space/page) stays local when still valid. Activity
 * and the agent log are unioned by id, newest first.
 */
export function mergeExternalKnowledgeStore(
  local: KnowledgeStore,
  incoming: KnowledgeStore,
  durable?: KnowledgeStore | null,
): KnowledgeExternalMergeResult {
  local = { ...local, pages: latestKnowledgePages(local.pages) }
  incoming = { ...incoming, pages: latestKnowledgePages(incoming.pages) }
  const conflicts: string[] = []
  const conflictIds: string[] = []
  const durableById = new Map(durable?.pages.map(page => [page.id, page]) ?? [])
  const hasLocalEdit = (page: KnowledgeStore['pages'][number]) => {
    const saved = durableById.get(page.id)
    return (
      !saved ||
      (saved !== page && serializePageFile(saved) !== serializePageFile(page))
    )
  }
  const localPagesById = new Map(local.pages.map(page => [page.id, page]))
  const incomingIds = new Set(incoming.pages.map(page => page.id))

  const pages = incoming.pages.map(incomingPage => {
    const localPage = localPagesById.get(incomingPage.id)
    if (!localPage || localPage === incomingPage) return incomingPage
    const localAt = Date.parse(localPage.updatedAt)
    const incomingAt = Date.parse(incomingPage.updatedAt)
    if (
      durable
        ? hasLocalEdit(localPage)
        : Number.isFinite(localAt) &&
          Number.isFinite(incomingAt) &&
          localAt > incomingAt
    ) {
      conflicts.push(localPage.title)
      conflictIds.push(localPage.id)
      return localPage
    }
    return incomingPage
  })
  const localOnly = local.pages.filter(page => !incomingIds.has(page.id))
  const wasSaved = (page: KnowledgePage) => durable && durableById.has(page.id)
  // A page this copy had saved and disk no longer has was deleted elsewhere: it stays deleted, and any words go elsewhere.
  const deletedWithWords = localOnly.filter(page => wasSaved(page) && hasLocalEdit(page))
  const localOnlyPages = localOnly.filter(page => !durable || (!wasSaved(page) && hasLocalEdit(page)))
  const mergedPages = [...localOnlyPages, ...pages]

  const incomingSpaceIds = new Set(incoming.spaces.map(space => space.id))
  const durableSpaceIds = new Set(durable?.spaces.map(space => space.id) ?? [])
  const localOnlySpaceIds = new Set(localOnlyPages.map(page => page.spaceId))
  const localOnlySpaces = local.spaces.filter(
    space =>
      !incomingSpaceIds.has(space.id) &&
      (!durable ||
        !durableSpaceIds.has(space.id) ||
        localOnlySpaceIds.has(space.id)),
  )
  const spaces = localOnlySpaces.length
    ? [...incoming.spaces, ...localOnlySpaces]
    : incoming.spaces

  const mergeById = <T extends { id: string }>(
    a: T[],
    b: T[],
    at: (item: T) => string,
  ): T[] => {
    const byId = new Map<string, T>()
    for (const item of [...a, ...b]) {
      if (!byId.has(item.id)) byId.set(item.id, item)
    }
    return [...byId.values()].sort(
      (x, y) =>
        latestTimestamp(at(y), undefined) - latestTimestamp(at(x), undefined),
    )
  }

  const activity = mergeById(incoming.activity, local.activity, item => item.at)
  const agentChanges = mergeById(
    incoming.agentChanges ?? [],
    local.agentChanges ?? [],
    item => item.proposedAt,
  )

  const activeSpaceId = spaces.some(space => space.id === local.activeSpaceId)
    ? local.activeSpaceId
    : incoming.activeSpaceId
  const exists = (pageId: string | null | undefined) =>
    Boolean(pageId) && mergedPages.some(page => page.id === pageId)
  // The page open here, else the one the file says, else another: the file's can be gone too, if a held copy deleted it.
  const activePageId = exists(local.activePageId)
    ? local.activePageId
    : exists(incoming.activePageId)
      ? incoming.activePageId
      : mergedPages.find(page => page.spaceId === activeSpaceId && page.kind === 'wiki')?.id ?? null

  const store: KnowledgeStore = {
    ...incoming,
    spaces,
    pages: mergedPages,
    activity,
    agentChanges,
    activeSpaceId,
    activePageId,
  }

  return {
    store,
    conflicts,
    conflictIds,
    deletedWithWords,
    changedFromIncoming:
      conflicts.length > 0 ||
      localOnlyPages.length > 0 ||
      spaces.length !== incoming.spaces.length,
  }
}

/** One-line notice for the header after an external reload. */
export function describeExternalReload(
  result: KnowledgeExternalMergeResult,
): string | null {
  if (!result.conflicts.length) return null
  const named = result.conflicts.slice(0, 3).join(', ')
  const extra =
    result.conflicts.length > 3 ? ` +${result.conflicts.length - 3} more` : ''
  return `Reloaded external changes — kept your newer edits to ${named}${extra}`
}
