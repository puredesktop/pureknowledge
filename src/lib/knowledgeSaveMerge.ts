/**
 * Saving when another live copy of the app may have written since this one last looked. A save never writes what memory
 * holds: each page and side file is merged against the file as it is now. `base` is what this copy last agreed with the
 * file; `mine` is what it holds; `disk` is the file. The rules:
 *
 * 1. A field only one side changed since base takes that side. Both changed: the newer edit.
 * 2. Words are never lost. When two different bodies meet, the page keeps the newer and the older becomes a page of its own.
 * 3. A page gone from disk that this copy held was deleted elsewhere. It stays deleted; words typed here become a page.
 */
import { slugifyPageTitle } from './knowledgeStore'
import { latestKnowledgePages, serializePageFile } from './knowledgePages'
import type { KnowledgeActivity, KnowledgeAgentChange, KnowledgePage, KnowledgeSpace, KnowledgeStore } from './knowledgeTypes'

const time = (value: string | undefined): number => {
  const parsed = Date.parse(value ?? '')
  return Number.isFinite(parsed) ? parsed : 0
}
const samePage = (a: KnowledgePage | null | undefined, b: KnowledgePage | null | undefined): boolean =>
  Boolean(a && b) && serializePageFile(a!) === serializePageFile(b!)
const sameBody = (a: string, b: string): boolean => a.trim() === b.trim()

/** The page file name's last part: every file of one page ends in it, whatever its slug was when written. */
export function pageFileSuffix(id: string): string {
  return `-${id.replace(/[^a-zA-Z0-9]/g, '').slice(-8) || 'x'}.md`
}

export type PageSaveOutcome =
  /** Write this: it is what the page is now. */
  | { kind: 'write'; page: KnowledgePage; keep?: string }
  /** The file is right as it is; memory takes it. */
  | { kind: 'file'; page: KnowledgePage; keep?: string }
  /** Deleted in another copy: not written back. */
  | { kind: 'gone'; keep?: string }

/** One page this copy changed. `keep` is words that lost, for a page of their own. */
export function resolvePageSave(input: { base: KnowledgePage | undefined; mine: KnowledgePage; disk: KnowledgePage | null }): PageSaveOutcome {
  const { base, mine, disk } = input
  const notAnEdit = base && samePage(base, mine)
  if (!disk) {
    if (!base) return { kind: 'write', page: mine }
    return { kind: 'gone', ...(!notAnEdit && !sameBody(mine.body, base.body) ? { keep: mine.body } : {}) }
  }
  if (notAnEdit) return { kind: 'file', page: disk }
  if (samePage(disk, mine)) return { kind: 'file', page: disk }
  if (base && samePage(disk, base)) return { kind: 'write', page: mine }
  // Both changed it.
  const mineNewer = time(mine.updatedAt) >= time(disk.updatedAt)
  const newer = mineNewer ? mine : disk
  const older = mineNewer ? disk : mine
  const merged = mergePageFields(base, mine, disk, newer)
  const bothWrote = !sameBody(mine.body, disk.body) && (!base || (!sameBody(mine.body, base.body) && !sameBody(disk.body, base.body)))
  const keep = bothWrote ? older.body : undefined
  if (samePage(merged, disk)) return { kind: 'file', page: disk, ...(keep ? { keep } : {}) }
  return { kind: 'write', page: merged, ...(keep ? { keep } : {}) }
}

function mergePageFields(base: KnowledgePage | undefined, mine: KnowledgePage, disk: KnowledgePage, newer: KnowledgePage): KnowledgePage {
  const merged: Record<string, unknown> = { ...newer }
  const keys = new Set([...Object.keys(mine), ...Object.keys(disk)]) as Set<keyof KnowledgePage>
  const text = (page: KnowledgePage | undefined, key: keyof KnowledgePage) => JSON.stringify(page?.[key])
  for (const key of keys) {
    if (key === 'updatedAt' || key === 'slug') continue
    if (!base) continue
    const mineChanged = text(mine, key) !== text(base, key)
    const diskChanged = text(disk, key) !== text(base, key)
    if (mineChanged === diskChanged) continue
    const taken = mineChanged ? mine[key] : disk[key]
    if (taken === undefined) delete merged[key]
    else merged[key] = taken
  }
  // A link added on either side stays: links are only ever added.
  const links = new Map([...disk.links, ...mine.links].map(link => [link.id, link]))
  merged.links = [...links.values()]
  merged.updatedAt = newer.updatedAt
  const title = merged.title as string
  merged.slug = title === mine.title ? mine.slug : title === disk.title ? disk.slug : slugifyPageTitle(title)
  return merged as unknown as KnowledgePage
}

/** Per space, by the same rules; a space new to either side stays, one deleted on either side stays deleted. */
export function mergeSpaces(base: readonly KnowledgeSpace[], mine: readonly KnowledgeSpace[], disk: readonly KnowledgeSpace[]): KnowledgeSpace[] {
  const baseById = new Map(base.map(space => [space.id, space]))
  const diskById = new Map(disk.map(space => [space.id, space]))
  const mineIds = new Set(mine.map(space => space.id))
  const same = (a: KnowledgeSpace | undefined, b: KnowledgeSpace | undefined) => JSON.stringify(a) === JSON.stringify(b)
  const merged: KnowledgeSpace[] = []
  for (const space of mine) {
    const held = baseById.get(space.id)
    const onDisk = diskById.get(space.id)
    if (!onDisk) {
      if (!held || !same(held, space)) merged.push(space)
      continue
    }
    if (same(space, onDisk) || same(onDisk, held)) merged.push(space)
    else if (same(space, held)) merged.push(onDisk)
    else merged.push(time(onDisk.updatedAt) > time(space.updatedAt) ? onDisk : space)
  }
  for (const space of disk) {
    if (!mineIds.has(space.id) && !baseById.has(space.id)) merged.push(space)
  }
  return merged
}

/** History only grows: both sides, newest first. */
export function mergeActivity(mine: readonly KnowledgeActivity[], disk: readonly KnowledgeActivity[]): KnowledgeActivity[] {
  const byId = new Map<string, KnowledgeActivity>()
  for (const item of [...mine, ...disk]) if (!byId.has(item.id)) byId.set(item.id, item)
  return [...byId.values()].sort((a, b) => time(b.at) - time(a.at))
}

/** A reviewed proposal stays reviewed: a copy that still shows it pending must not reopen it. */
export function mergeProposals(mine: readonly KnowledgeAgentChange[], disk: readonly KnowledgeAgentChange[]): KnowledgeAgentChange[] {
  const diskById = new Map(disk.map(change => [change.id, change]))
  const mineIds = new Set(mine.map(change => change.id))
  const pick = (a: KnowledgeAgentChange, b: KnowledgeAgentChange): KnowledgeAgentChange => {
    if ((a.status === 'pending') !== (b.status === 'pending')) return a.status === 'pending' ? b : a
    return time(b.reviewedAt) > time(a.reviewedAt) ? b : a
  }
  const merged = mine.map(change => {
    const other = diskById.get(change.id)
    return other ? pick(change, other) : change
  })
  return [...merged, ...disk.filter(change => !mineIds.has(change.id))].sort((a, b) => time(b.proposedAt) - time(a.proposedAt))
}

export function keptPageTitle(title: string, at: string): string {
  const when = new Date(at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  return `${title} (kept from another window, ${when})`
}

/** Words that lost, as a page of their own next to the one they came from. Never a published policy, never a directory. */
export function keptKnowledgePage(input: {
  from: KnowledgePage
  body: string
  at: string
  id: string
  /** The page it sits under, when that page is still there. */
  parentId: string | null
}): KnowledgePage {
  const { from, body, at, id, parentId } = input
  const title = keptPageTitle(from.title, at)
  return {
    ...(from.governance ? { governance: { category: from.governance.category } } : {}),
    id,
    spaceId: from.spaceId,
    parentId,
    kind: from.kind,
    slug: slugifyPageTitle(title),
    title,
    body,
    tags: ['kept-copy'],
    links: from.links,
    aliases: [],
    createdAt: at,
    updatedAt: at,
  }
}

/** Keep another copy's version of a page as a page of its own, for an editor about to save over it. */
export function keepKnowledgeVersion(store: KnowledgeStore, page: KnowledgePage, at = new Date().toISOString()): KnowledgeStore {
  const parentId = page.parentId && store.pages.some(candidate => candidate.id === page.parentId)
    ? page.parentId
    : store.spaces.find(space => space.id === page.spaceId)?.rootPageId ?? null
  const kept = keptKnowledgePage({ from: page, body: page.body, at, id: `page-${crypto.randomUUID()}`, parentId })
  return {
    ...store,
    pages: [kept, ...store.pages],
    activity: [
      { id: `activity-${crypto.randomUUID()}`, pageId: kept.id, at, type: 'page.created', text: `Kept the other version of ${page.title}` },
      ...store.activity,
    ],
  }
}

/**
 * What a save settled, folded into memory that may have moved on while it was writing. Pages edited meanwhile stay as
 * they are: the next save merges them.
 */
export function foldSavedStore(local: KnowledgeStore, saved: KnowledgeStore, settled: KnowledgeStore): KnowledgeStore {
  if (local === saved) return settled
  const savedById = new Map(saved.pages.map(page => [page.id, page]))
  const settledById = new Map(settled.pages.map(page => [page.id, page]))
  const localIds = new Set(local.pages.map(page => page.id))
  const pages: KnowledgePage[] = []
  for (const page of local.pages) {
    const before = savedById.get(page.id)
    if (before !== page) pages.push(page)
    else if (settledById.has(page.id)) pages.push(settledById.get(page.id)!)
  }
  for (const page of settled.pages) {
    if (!localIds.has(page.id) && !savedById.has(page.id)) pages.push(page)
  }
  return {
    ...local,
    pages: latestKnowledgePages(pages),
    spaces: local.spaces === saved.spaces ? settled.spaces : local.spaces,
    activity: local.activity === saved.activity ? settled.activity : mergeActivity(local.activity, settled.activity),
    agentChanges: (local.agentChanges ?? []) === (saved.agentChanges ?? []) ? settled.agentChanges : mergeProposals(local.agentChanges ?? [], settled.agentChanges ?? []),
  }
}
