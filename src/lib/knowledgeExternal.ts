/** Merge content written by another app instance into the local state. */
import type { KnowledgeStore } from './knowledgeTypes'

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
 * Selection (active space/page) stays local when still valid. Activity
 * and the agent log are unioned by id, newest first.
 */
export function mergeExternalKnowledgeStore(
  local: KnowledgeStore,
  incoming: KnowledgeStore,
): KnowledgeExternalMergeResult {
  const conflicts: string[] = []
  const localPagesById = new Map(local.pages.map(page => [page.id, page]))
  const incomingIds = new Set(incoming.pages.map(page => page.id))

  const pages = incoming.pages.map(incomingPage => {
    const localPage = localPagesById.get(incomingPage.id)
    if (!localPage || localPage === incomingPage) return incomingPage
    const localAt = Date.parse(localPage.updatedAt)
    const incomingAt = Date.parse(incomingPage.updatedAt)
    if (
      Number.isFinite(localAt) &&
      Number.isFinite(incomingAt) &&
      localAt > incomingAt
    ) {
      conflicts.push(localPage.title)
      return localPage
    }
    return incomingPage
  })
  const localOnlyPages = local.pages.filter(page => !incomingIds.has(page.id))
  const mergedPages = [...localOnlyPages, ...pages]

  const incomingSpaceIds = new Set(incoming.spaces.map(space => space.id))
  const spaces = [
    ...incoming.spaces,
    ...local.spaces.filter(space => !incomingSpaceIds.has(space.id)),
  ]

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
      (x, y) => latestTimestamp(at(y), undefined) - latestTimestamp(at(x), undefined),
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
  const activePageId =
    local.activePageId && mergedPages.some(page => page.id === local.activePageId)
      ? local.activePageId
      : incoming.activePageId

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
