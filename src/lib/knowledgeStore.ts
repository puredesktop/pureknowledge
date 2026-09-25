/*
 * Note on the `activity` arrays written throughout this store:
 * DEPRECATED(operations-ledger) — as a CROSS-APP FEED source only. They stay
 * as in-app knowledge history, but the assistant's ledger no longer scrapes
 * them; interactions worth surfacing suite-wide must also go through
 * `recordOperation` (see bridge/platformBridge.ts).
 */
import type {
  CreatePageInput,
  CreateSpaceInput,
  KnowledgeActivity,
  KnowledgeAgentChange,
  KnowledgeAgentChangePatch,
  KnowledgeAgentChangeSeverity,
  KnowledgeAgentChangeType,
  KnowledgeLink,
  KnowledgePage,
  KnowledgeSpace,
  KnowledgeStore,
} from './knowledgeTypes'

const SCHEMA_VERSION = 1
const DIRECTORY_TAG = 'directory'

export interface KnowledgeMutationActor {
  type: NonNullable<KnowledgeActivity['actorType']>
  name?: string
}

interface KnowledgeMutationOptions {
  actor?: KnowledgeMutationActor
}

export interface ProposeKnowledgeAgentChangeInput {
  spaceId: string
  pageId?: string
  agentName: string
  agentId?: string
  sourceAppSlug?: string
  severity?: KnowledgeAgentChangeSeverity
  changeType: KnowledgeAgentChangeType
  title: string
  summary: string
  before?: string
  after?: string
  patch: KnowledgeAgentChangePatch
}

function createId(prefix: string): string {
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2)
  return `${prefix}-${random}`
}

function now(): string {
  return new Date().toISOString()
}

export function slugifyPageTitle(title: string): string {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'untitled'
}

/**
 * The rich editor's markdown serializer escapes literal brackets, so a
 * typed [[Page]] round-trips as \[\[Page\]\]. Wikilink syntax is OURS —
 * normalize the escaped form back before extraction or rendering.
 */
export function normalizeWikiLinkEscapes(text: string): string {
  return text.replace(/\\\[\\\[([^\]]*?)\\\]\\\]/g, '[[$1]]')
}

export function extractWikiLinks(body: string): string[] {
  const links = new Set<string>()
  const pattern = /\[\[([^\]]+)\]\]/g
  body = normalizeWikiLinkEscapes(body)
  let match = pattern.exec(body)
  while (match) {
    const title = match[1]?.trim()
    if (title) links.add(title)
    match = pattern.exec(body)
  }
  return [...links]
}

export function isKnowledgeDirectoryPage(page: KnowledgePage): boolean {
  return page.kind === 'wiki' && page.tags.includes(DIRECTORY_TAG)
}

export function createDirectoryIndexBody(title: string): string {
  return `Index for ${
    title.trim() || 'this directory'
  }.\n\nAgents maintain this page with a short note about what exists in each file in this directory.`
}

function activity(
  type: KnowledgeActivity['type'],
  text: string,
  pageId?: string,
  actor?: KnowledgeMutationActor,
): KnowledgeActivity {
  return {
    id: createId('activity'),
    pageId,
    at: now(),
    actorType: actor?.type,
    actorName: actor?.name,
    type,
    text,
  }
}

export function createDefaultKnowledgeStore(): KnowledgeStore {
  const at = now()
  const spaceId = createId('space')
  const pageId = createId('page')
  return {
    schemaVersion: SCHEMA_VERSION,
    spaces: [
      {
        id: spaceId,
        name: 'Knowledge Base',
        description: 'Durable context for PureScience work.',
        rootPageId: pageId,
        createdAt: at,
        updatedAt: at,
      },
    ],
    pages: [
      {
        id: pageId,
        spaceId,
        parentId: null,
        kind: 'wiki',
        slug: 'index',
        title: '_index',
        body: 'This is the root index for the wiki. Agents maintain this page with a short note about what exists in each top-level file and directory.',
        tags: ['start'],
        links: [],
        aliases: ['Start here'],
        createdAt: at,
        updatedAt: at,
      },
    ],
    activity: [
      {
        id: createId('activity'),
        pageId,
        at,
        type: 'page.created',
        text: 'Created starter wiki page',
      },
    ],
    agentChanges: [],
    activeSpaceId: spaceId,
    activePageId: pageId,
  }
}

export function parseKnowledgeStore(text: string): KnowledgeStore {
  const parsed = JSON.parse(text) as Partial<KnowledgeStore>
  return migrateKnowledgeStore(parsed)
}

export function serializeKnowledgeStore(store: KnowledgeStore): string {
  return `${JSON.stringify(store, null, 2)}\n`
}

export function migrateKnowledgeStore(
  input: Partial<KnowledgeStore> | null | undefined,
): KnowledgeStore {
  if (!input || input.schemaVersion !== SCHEMA_VERSION) {
    return createDefaultKnowledgeStore()
  }

  const fallback = createDefaultKnowledgeStore()
  const rawSpaces = Array.isArray(input.spaces) ? input.spaces : fallback.spaces
  const rawPages = Array.isArray(input.pages) ? input.pages : fallback.pages
  const pages: KnowledgePage[] = rawPages.map(rawPage => {
    const page = rawPage as KnowledgePage
    const tags = Array.isArray(page.tags) ? page.tags : []
    const body = typeof page.body === 'string' ? page.body : ''
    return {
      ...page,
      parentId:
        typeof page.parentId === 'string' || page.parentId === null
          ? page.parentId
          : null,
      slug: page.slug || slugifyPageTitle(page.title),
      aliases: Array.isArray(page.aliases) ? page.aliases : [],
      body:
        tags.includes(DIRECTORY_TAG) && !body.trim()
          ? createDirectoryIndexBody(page.title)
          : body,
      tags,
      links: Array.isArray(page.links) ? page.links : [],
    }
  })
  const spaces = rawSpaces.map(rawSpace => {
    const space = rawSpace as KnowledgeSpace
    const wikiPages = pages.filter(
      page => page.spaceId === space.id && page.kind === 'wiki',
    )
    const rootPage =
      wikiPages.find(page => page.id === space.rootPageId) ??
      wikiPages.find(page => page.title === '_index') ??
      wikiPages.find(page => page.slug === 'index') ??
      wikiPages.find(page => page.slug === 'home') ??
      wikiPages.find(page => page.title.toLowerCase() === 'start here') ??
      wikiPages[0] ??
      null

    return {
      ...space,
      rootPageId: rootPage?.id ?? null,
    }
  })
  const activeSpaceId =
    input.activeSpaceId &&
    spaces.some(space => space.id === input.activeSpaceId)
      ? input.activeSpaceId
      : spaces[0]?.id ?? fallback.activeSpaceId
  const activePageId =
    input.activePageId && pages.some(page => page.id === input.activePageId)
      ? input.activePageId
      : pages.find(page => page.spaceId === activeSpaceId)?.id ?? null
  const agentChanges = Array.isArray(input.agentChanges)
    ? input.agentChanges.map(rawChange => {
        const change = rawChange as KnowledgeAgentChange
        return {
          ...change,
          status: change.status ?? 'pending',
          severity: change.severity ?? 'normal',
          patch: change.patch ?? {},
        }
      })
    : []

  return {
    schemaVersion: SCHEMA_VERSION,
    spaces,
    pages,
    activity: Array.isArray(input.activity) ? input.activity : [],
    agentChanges,
    activeSpaceId,
    activePageId,
  }
}

export function createKnowledgeSpace(
  store: KnowledgeStore,
  input: CreateSpaceInput,
  options: KnowledgeMutationOptions = {},
): KnowledgeStore {
  const name = input.name.trim()
  if (!name) return store

  const at = now()
  const rootPageId = createId('page')
  const space = {
    id: createId('space'),
    name,
    description: input.description?.trim() ?? '',
    rootPageId,
    createdAt: at,
    updatedAt: at,
  }
  const rootPage: KnowledgePage = {
    id: rootPageId,
    spaceId: space.id,
    parentId: null,
    kind: 'wiki',
    slug: 'index',
    title: '_index',
    body: createDirectoryIndexBody(name),
    tags: [],
    links: [],
    aliases: [],
    createdAt: at,
    updatedAt: at,
  }

  return {
    ...store,
    spaces: [...store.spaces, space],
    pages: [rootPage, ...store.pages],
    activeSpaceId: space.id,
    activePageId: rootPage.id,
    activity: [
      activity(
        'space.created',
        `Created space ${space.name}`,
        undefined,
        options.actor,
      ),
      activity(
        'page.created',
        `Created root page _index`,
        rootPage.id,
        options.actor,
      ),
      ...store.activity,
    ],
  }
}

export function createKnowledgePage(
  store: KnowledgeStore,
  input: CreatePageInput,
  options: KnowledgeMutationOptions = {},
): KnowledgeStore {
  const title = input.title.trim()
  if (!title) return store

  const at = now()
  const page: KnowledgePage = {
    id: createId('page'),
    spaceId: input.spaceId,
    parentId: input.parentId ?? null,
    kind: input.kind,
    slug: slugifyPageTitle(title),
    title,
    body: input.body?.trim() ?? '',
    tags: input.tags ?? [],
    links: [],
    aliases: [],
    createdAt: at,
    updatedAt: at,
  }

  return {
    ...store,
    pages: [page, ...store.pages],
    activeSpaceId: page.spaceId,
    activePageId: page.id,
    activity: [
      activity(
        'page.created',
        `Created ${page.kind === 'wiki' ? 'wiki page' : 'note'} ${page.title}`,
        page.id,
        options.actor,
      ),
      ...store.activity,
    ],
  }
}

export function updateKnowledgePage(
  store: KnowledgeStore,
  pageId: string,
  patch: Partial<
    Pick<KnowledgePage, 'title' | 'body' | 'tags' | 'kind' | 'parentId'>
  >,
  options: KnowledgeMutationOptions = {},
): KnowledgeStore {
  const page = store.pages.find(candidate => candidate.id === pageId)
  if (!page) return store
  const title = patch.title?.trim() || page.title
  const body = patch.body ?? page.body
  const tags = patch.tags ?? page.tags
  const kind = patch.kind ?? page.kind
  const parentId = patch.parentId === undefined ? page.parentId : patch.parentId

  if (
    title === page.title &&
    body === page.body &&
    kind === page.kind &&
    parentId === page.parentId &&
    tags.length === page.tags.length &&
    tags.every((tag, index) => tag === page.tags[index])
  ) {
    return store
  }

  const nextPage: KnowledgePage = {
    ...page,
    ...patch,
    title,
    body,
    tags,
    kind,
    parentId,
    slug: title === page.title ? page.slug : slugifyPageTitle(title),
    updatedAt: now(),
    promotedAt:
      page.kind === 'note' && patch.kind === 'wiki' ? now() : page.promotedAt,
  }

  const promoted = page.kind === 'note' && nextPage.kind === 'wiki'

  return {
    ...store,
    pages: store.pages.map(candidate =>
      candidate.id === pageId ? nextPage : candidate,
    ),
    activity: [
      activity(
        promoted ? 'page.promoted' : 'page.updated',
        promoted
          ? `Promoted ${nextPage.title} to wiki`
          : `Updated ${nextPage.title}`,
        nextPage.id,
        options.actor,
      ),
      ...store.activity,
    ],
  }
}

export function deleteKnowledgePage(
  store: KnowledgeStore,
  pageId: string,
  options: KnowledgeMutationOptions = {},
): KnowledgeStore {
  const page = store.pages.find(candidate => candidate.id === pageId)
  if (!page) return store
  if (store.spaces.some(space => space.rootPageId === pageId)) return store

  const pageIdsToDelete = new Set<string>([pageId])
  let changed = true
  while (changed) {
    changed = false
    for (const candidate of store.pages) {
      if (
        candidate.parentId &&
        pageIdsToDelete.has(candidate.parentId) &&
        !pageIdsToDelete.has(candidate.id)
      ) {
        pageIdsToDelete.add(candidate.id)
        changed = true
      }
    }
  }

  const remainingPages = store.pages.filter(
    candidate => !pageIdsToDelete.has(candidate.id),
  )
  const fallbackPage =
    remainingPages.find(candidate => candidate.id === page.parentId) ??
    remainingPages.find(candidate => candidate.spaceId === page.spaceId) ??
    null

  return {
    ...store,
    pages: remainingPages,
    activePageId: pageIdsToDelete.has(store.activePageId ?? '')
      ? fallbackPage?.id ?? null
      : store.activePageId,
    activity: [
      activity(
        'page.deleted',
        `Deleted wiki page ${page.title}`,
        undefined,
        options.actor,
      ),
      ...store.activity,
    ],
  }
}

export function normalizeKnowledgeLink(
  input: Partial<KnowledgeLink>,
): KnowledgeLink | null {
  const title =
    input.title?.trim() ||
    input.path?.split('/').filter(Boolean).at(-1) ||
    input.url ||
    input.resourceId ||
    ''
  if (!title) return null

  const type =
    input.type ?? (input.url ? 'url' : input.path ? 'file' : 'resource')
  return {
    id: input.id ?? createId('link'),
    type,
    title,
    path: input.path?.trim() || undefined,
    appSlug: input.appSlug?.trim() || undefined,
    resourceId: input.resourceId?.trim() || undefined,
    url: input.url?.trim() || undefined,
  }
}

export function addKnowledgeLink(
  store: KnowledgeStore,
  pageId: string,
  linkInput: Partial<KnowledgeLink>,
  options: KnowledgeMutationOptions = {},
): KnowledgeStore {
  const link = normalizeKnowledgeLink(linkInput)
  if (!link) return store

  const page = store.pages.find(candidate => candidate.id === pageId)
  if (!page) return store

  return {
    ...store,
    pages: store.pages.map(candidate =>
      candidate.id === pageId
        ? { ...candidate, links: [...candidate.links, link], updatedAt: now() }
        : candidate,
    ),
    activity: [
      activity(
        'link.created',
        `Linked ${link.title} to ${page.title}`,
        pageId,
        options.actor,
      ),
      ...store.activity,
    ],
  }
}

export interface KnowledgePageSearchHit {
  page: KnowledgePage
  score: number
  snippet: string
}

/**
 * Rank pages for a query across title, aliases, tags, body, slug,
 * wikilink targets, and attached resource links. An empty query returns
 * the most recently updated pages — "what's in here". This is the one
 * search implementation: the sidebar SearchField and the searchKnowledge
 * agent tool both go through it.
 */
export function rankKnowledgePages(
  store: KnowledgeStore,
  query: string,
  limit = 10,
): KnowledgePageSearchHit[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  const snippetFor = (page: KnowledgePage): string => {
    const body = page.body.replace(/\s+/g, ' ').trim()
    if (!terms.length) return body.slice(0, 160)
    const lowered = body.toLowerCase()
    const index = terms
      .map(term => lowered.indexOf(term))
      .filter(position => position !== -1)
      .sort((a, b) => a - b)[0]
    if (index === undefined) return body.slice(0, 160)
    const start = Math.max(0, index - 60)
    return `${start > 0 ? '…' : ''}${body.slice(start, start + 180)}`
  }
  if (!terms.length) {
    return [...store.pages]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit)
      .map(page => ({ page, score: 0, snippet: snippetFor(page) }))
  }
  const hits: KnowledgePageSearchHit[] = []
  for (const page of store.pages) {
    const title = page.title.toLowerCase()
    const aliases = (page.aliases ?? []).join(' ').toLowerCase()
    const tags = page.tags.join(' ').toLowerCase()
    const body = page.body.toLowerCase()
    // Everything else the page is reachable by: slug, wikilink targets,
    // and the attached resource links (titles, paths, urls).
    const related = [
      page.slug,
      ...extractWikiLinks(page.body),
      ...page.links.flatMap(link => [
        link.title,
        link.path,
        link.appSlug,
        link.resourceId,
        link.url,
      ]),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
    let score = 0
    for (const term of terms) {
      if (title.includes(term)) score += 3
      if (aliases.includes(term)) score += 2
      if (tags.includes(term)) score += 2
      if (body.includes(term)) score += 1
      if (related.includes(term)) score += 1
    }
    if (score > 0) hits.push({ page, score, snippet: snippetFor(page) })
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit)
}

/**
 * LEGACY(review-queue) — production code no longer proposes: agent writes
 * go through applyKnowledgeAgentChange (direct write + log entry). This
 * stays only so existing 'pending' entries keep their Accept/Reject flow
 * and so tests can build them. Do not add new call sites.
 */
export function proposeKnowledgeAgentChange(
  store: KnowledgeStore,
  input: ProposeKnowledgeAgentChangeInput,
): KnowledgeStore {
  const title = input.title.trim()
  const summary = input.summary.trim()
  if (!title || !summary) return store

  const at = now()
  const change: KnowledgeAgentChange = {
    id: createId('agent-change'),
    spaceId: input.spaceId,
    pageId: input.pageId,
    agentName: input.agentName.trim() || 'Agent',
    agentId: input.agentId?.trim() || undefined,
    sourceAppSlug: input.sourceAppSlug?.trim() || undefined,
    proposedAt: at,
    status: 'pending',
    severity: input.severity ?? 'normal',
    changeType: input.changeType,
    title,
    summary,
    before: input.before,
    after: input.after,
    patch: input.patch,
  }

  return {
    ...store,
    agentChanges: [change, ...(store.agentChanges ?? [])],
    activity: [
      activity(
        'agentChange.proposed',
        `${change.agentName} proposed ${change.title}`,
        input.pageId,
        { type: 'agent', name: change.agentName },
      ),
      ...store.activity,
    ],
  }
}

/**
 * Apply one agent change's patch to the store — shared by the legacy
 * accept path and the direct-write path.
 */
function applyAgentChangeToPages(
  store: KnowledgeStore,
  change: Pick<KnowledgeAgentChange, 'changeType' | 'pageId' | 'patch' | 'spaceId' | 'title' | 'agentName'>,
): KnowledgeStore {
  let nextStore = store
  const actor = { type: 'agent' as const, name: change.agentName }
  const applyLinks = (target: KnowledgeStore, pageId: string): KnowledgeStore =>
    (change.patch.links ?? []).reduce(
      (acc, link) => addKnowledgeLink(acc, pageId, link, { actor }),
      target,
    )

  if (change.changeType === 'page.create') {
    nextStore = createKnowledgePage(
      nextStore,
      {
        spaceId: change.spaceId,
        parentId: change.patch.parentId ?? null,
        kind: change.patch.kind ?? 'wiki',
        title: change.patch.title ?? change.title,
        body: change.patch.body,
        tags: change.patch.tags,
      },
      { actor },
    )
    // createKnowledgePage focuses the page it made.
    if (nextStore.activePageId) {
      nextStore = applyLinks(nextStore, nextStore.activePageId)
    }
  } else if (change.changeType === 'page.update' && change.pageId) {
    nextStore = updateKnowledgePage(
      nextStore,
      change.pageId,
      {
        title: change.patch.title,
        body: change.patch.body,
        tags: change.patch.tags,
        kind: change.patch.kind,
        parentId: change.patch.parentId,
      },
      { actor },
    )
    nextStore = applyLinks(nextStore, change.pageId)
  } else if (change.changeType === 'page.link' && change.pageId) {
    nextStore = change.patch.link
      ? addKnowledgeLink(nextStore, change.pageId, change.patch.link, { actor })
      : nextStore
  } else if (change.changeType === 'page.rename' && change.pageId) {
    nextStore = change.patch.title
      ? updateKnowledgePage(
          nextStore,
          change.pageId,
          { title: change.patch.title },
          { actor },
        )
      : nextStore
  } else if (change.changeType === 'page.promote' && change.pageId) {
    nextStore = updateKnowledgePage(
      nextStore,
      change.pageId,
      { kind: 'wiki' },
      { actor },
    )
  } else if (change.changeType === 'page.delete' && change.pageId) {
    nextStore = deleteKnowledgePage(nextStore, change.pageId, { actor })
  } else if (
    change.changeType === 'page.merge' &&
    change.pageId &&
    change.patch.mergeIntoPageId
  ) {
    // The merged body was proposed against the surviving page; the source
    // page is deleted once the survivor carries the combined content.
    nextStore = updateKnowledgePage(
      nextStore,
      change.patch.mergeIntoPageId,
      { body: change.patch.body },
      { actor },
    )
    nextStore = deleteKnowledgePage(nextStore, change.pageId, { actor })
  }

  return nextStore
}

export function acceptKnowledgeAgentChange(
  store: KnowledgeStore,
  changeId: string,
): KnowledgeStore {
  const change = (store.agentChanges ?? []).find(
    candidate => candidate.id === changeId,
  )
  if (!change || change.status !== 'pending') return store

  const nextStore = applyAgentChangeToPages(store, change)

  const reviewedAt = now()
  return {
    ...nextStore,
    agentChanges: (nextStore.agentChanges ?? store.agentChanges ?? []).map(
      candidate =>
        candidate.id === changeId
          ? { ...candidate, status: 'accepted', reviewedAt }
          : candidate,
    ),
    activity: [
      activity(
        'agentChange.accepted',
        `Accepted ${change.agentName} proposal: ${change.title}`,
        change.pageId,
        { type: 'human', name: 'You' },
      ),
      ...nextStore.activity,
    ],
  }
}

/**
 * Direct-write path: apply an agent change to the wiki immediately and
 * record it in the agent log with status 'applied'. The log entry keeps
 * before/after so the change is auditable and revertable by hand.
 */
export function applyKnowledgeAgentChange(
  store: KnowledgeStore,
  input: ProposeKnowledgeAgentChangeInput,
): KnowledgeStore {
  const title = input.title.trim()
  const summary = input.summary.trim()
  if (!title || !summary) return store

  const at = now()
  const draft: Pick<
    KnowledgeAgentChange,
    'changeType' | 'pageId' | 'patch' | 'spaceId' | 'title' | 'agentName'
  > = {
    spaceId: input.spaceId,
    pageId: input.pageId,
    agentName: input.agentName.trim() || 'Agent',
    changeType: input.changeType,
    title,
    patch: input.patch,
  }
  const nextStore = applyAgentChangeToPages(store, draft)
  const pageId =
    input.changeType === 'page.create'
      ? nextStore.activePageId ?? undefined
      : input.pageId

  const change: KnowledgeAgentChange = {
    id: createId('agent-change'),
    spaceId: input.spaceId,
    pageId,
    agentName: draft.agentName,
    agentId: input.agentId?.trim() || undefined,
    sourceAppSlug: input.sourceAppSlug?.trim() || undefined,
    proposedAt: at,
    reviewedAt: at,
    status: 'applied',
    severity: input.severity ?? 'normal',
    changeType: input.changeType,
    title,
    summary,
    before: input.before,
    after: input.after,
    patch: input.patch,
  }

  return {
    ...nextStore,
    agentChanges: [change, ...(nextStore.agentChanges ?? [])],
    activity: [
      activity(
        'agentChange.applied',
        `${change.agentName} wrote ${change.title}`,
        pageId,
        { type: 'agent', name: change.agentName },
      ),
      ...nextStore.activity,
    ],
  }
}

export function rejectKnowledgeAgentChange(
  store: KnowledgeStore,
  changeId: string,
): KnowledgeStore {
  const change = (store.agentChanges ?? []).find(
    candidate => candidate.id === changeId,
  )
  if (!change || change.status !== 'pending') return store

  const reviewedAt = now()
  return {
    ...store,
    agentChanges: (store.agentChanges ?? []).map(candidate =>
      candidate.id === changeId
        ? { ...candidate, status: 'rejected', reviewedAt }
        : candidate,
    ),
    activity: [
      activity(
        'agentChange.rejected',
        `Rejected ${change.agentName} proposal: ${change.title}`,
        change.pageId,
        { type: 'human', name: 'You' },
      ),
      ...store.activity,
    ],
  }
}

export function getWikiPagesForSpace(
  store: KnowledgeStore,
  spaceId: string,
): KnowledgePage[] {
  return store.pages.filter(
    page => page.spaceId === spaceId && page.kind === 'wiki',
  )
}

export function getChildWikiPages(
  store: KnowledgeStore,
  parentId: string,
): KnowledgePage[] {
  return store.pages
    .filter(page => page.kind === 'wiki' && page.parentId === parentId)
    .sort((a, b) => a.title.localeCompare(b.title))
}

export function findPageByWikiTitle(
  store: KnowledgeStore,
  spaceId: string,
  title: string,
): KnowledgePage | null {
  const slug = slugifyPageTitle(title)
  return (
    store.pages.find(
      page =>
        page.spaceId === spaceId &&
        page.kind === 'wiki' &&
        (page.slug === slug ||
          page.title.toLowerCase() === title.trim().toLowerCase() ||
          page.aliases?.some(
            alias => alias.trim().toLowerCase() === title.trim().toLowerCase(),
          )),
    ) ?? null
  )
}

export function findPagePath(
  store: KnowledgeStore,
  pageId: string,
): KnowledgePage[] {
  const pageById = new Map(store.pages.map(page => [page.id, page]))
  const path: KnowledgePage[] = []
  const seen = new Set<string>()
  let cursor = pageById.get(pageId) ?? null
  while (cursor && !seen.has(cursor.id)) {
    path.unshift(cursor)
    seen.add(cursor.id)
    cursor = cursor.parentId ? pageById.get(cursor.parentId) ?? null : null
  }
  return path
}

export function findWikiBacklinks(
  store: KnowledgeStore,
  targetPage: KnowledgePage,
): KnowledgePage[] {
  const targetNames = new Set([
    targetPage.slug,
    slugifyPageTitle(targetPage.title),
    ...(targetPage.aliases ?? []).map(slugifyPageTitle),
  ])
  return store.pages.filter(page => {
    if (page.id === targetPage.id || page.spaceId !== targetPage.spaceId) {
      return false
    }
    return extractWikiLinks(page.body).some(link =>
      targetNames.has(slugifyPageTitle(link)),
    )
  })
}

export interface KnowledgeReviewFinding {
  kind: 'brokenLink' | 'orphan' | 'stale' | 'duplicateTitle'
  pageId: string
  pageTitle: string
  detail: string
}

export const KNOWLEDGE_STALE_AFTER_DAYS = 90

/**
 * Curation sweep over one space: broken wikilinks, orphan wiki pages,
 * stale pages, and near-duplicate titles. Read-only — findings are meant
 * to become proposals the user reviews, never silent fixes.
 */
export function reviewKnowledgeStore(
  store: KnowledgeStore,
  spaceId: string,
  nowMs: number,
): KnowledgeReviewFinding[] {
  const findings: KnowledgeReviewFinding[] = []
  const pages = store.pages.filter(page => page.spaceId === spaceId)
  const rootIds = new Set(
    store.spaces.map(space => space.rootPageId).filter(Boolean) as string[],
  )

  for (const page of pages) {
    for (const link of extractWikiLinks(page.body)) {
      if (!findPageByWikiTitle(store, spaceId, link)) {
        findings.push({
          kind: 'brokenLink',
          pageId: page.id,
          pageTitle: page.title,
          detail: `[[${link}]] resolves to no page`,
        })
      }
    }
  }

  const childCount = new Map<string, number>()
  for (const page of pages) {
    if (page.parentId) {
      childCount.set(page.parentId, (childCount.get(page.parentId) ?? 0) + 1)
    }
  }
  for (const page of pages) {
    if (page.kind !== 'wiki') continue
    if (rootIds.has(page.id)) continue
    if (isKnowledgeDirectoryPage(page)) continue
    if (childCount.get(page.id)) continue
    if (findWikiBacklinks(store, page).length === 0) {
      findings.push({
        kind: 'orphan',
        pageId: page.id,
        pageTitle: page.title,
        detail: 'No page links here and it has no children',
      })
    }
  }

  const staleBefore = nowMs - KNOWLEDGE_STALE_AFTER_DAYS * 24 * 60 * 60 * 1000
  for (const page of pages) {
    const updated = Date.parse(page.updatedAt)
    if (Number.isFinite(updated) && updated < staleBefore) {
      findings.push({
        kind: 'stale',
        pageId: page.id,
        pageTitle: page.title,
        detail: `Not updated since ${page.updatedAt.slice(0, 10)}`,
      })
    }
  }

  const bySlug = new Map<string, KnowledgePage[]>()
  for (const page of pages) {
    const key = slugifyPageTitle(page.title)
    bySlug.set(key, [...(bySlug.get(key) ?? []), page])
  }
  for (const group of bySlug.values()) {
    if (group.length < 2) continue
    for (const page of group) {
      findings.push({
        kind: 'duplicateTitle',
        pageId: page.id,
        pageTitle: page.title,
        detail: `${group.length} pages share this title`,
      })
    }
  }

  return findings
}
