import {
  agentToolErrorContent,
  formatAgentToolJson,
  readAgentToolStringArg,
} from '@purescience/platform-ui/bridge/agentToolHelpers'
import type { AgentToolHandlerResult } from '@purescience/platform-ui/bridge/react/usePlatformAgentTools'
import { recordOperation } from '../bridge/platformBridge'
import { KNOWLEDGE_APP_SLUG } from '../constants'
import {
  applyKnowledgeAgentChange,
  findWikiBacklinks,
  rankKnowledgePages,
  reviewKnowledgeStore,
} from '../lib/knowledgeStore'
import type {
  KnowledgeAgentChangeType,
  KnowledgeLink,
  KnowledgePage,
  KnowledgeStore,
} from '../lib/knowledgeTypes'
import type { KnowledgeAgentToolContext } from './catalog'

function requireStore(
  context: KnowledgeAgentToolContext,
): KnowledgeStore | { error: string } {
  if (!context.store) {
    return { error: 'The knowledge base is still loading; try again shortly.' }
  }
  return context.store
}

function pageByRef(
  store: KnowledgeStore,
  ref: string,
): KnowledgePage | undefined {
  const lowered = ref.trim().toLowerCase()
  return store.pages.find(
    page =>
      page.id === ref ||
      page.slug.toLowerCase() === lowered ||
      page.title.toLowerCase() === lowered ||
      (page.aliases ?? []).some(alias => alias.toLowerCase() === lowered),
  )
}

function spaceByRef(
  store: KnowledgeStore,
  ref: string,
): KnowledgeStore['spaces'][number] | undefined {
  const lowered = ref.trim().toLowerCase()
  return store.spaces.find(
    space => space.id === ref || space.name.toLowerCase() === lowered,
  )
}

function readLinksArg(
  args: Record<string, unknown>,
): Partial<KnowledgeLink>[] | undefined {
  const raw = args.links
  if (!Array.isArray(raw)) return undefined
  const links: Partial<KnowledgeLink>[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const candidate = item as Record<string, unknown>
    const link: Partial<KnowledgeLink> = {}
    for (const key of [
      'type',
      'title',
      'path',
      'appSlug',
      'resourceId',
      'url',
    ] as const) {
      const value = candidate[key]
      if (typeof value === 'string' && value.trim()) {
        link[key] = value.trim() as never
      }
    }
    if (Object.keys(link).length) links.push(link)
  }
  return links
}

/**
 * The "call this first" tool: compact ground truth for every reference
 * the other tools take — active space and page, the space map, counts,
 * and the store path.
 */
export function getKnowledgeContextHandler(
  context: KnowledgeAgentToolContext,
): AgentToolHandlerResult {
  const store = requireStore(context)
  if ('error' in store) return agentToolErrorContent(store.error)
  const activeSpace =
    store.spaces.find(space => space.id === store.activeSpaceId) ??
    store.spaces[0] ??
    null
  const activePage = store.activePageId
    ? store.pages.find(page => page.id === store.activePageId) ?? null
    : null
  return {
    content: formatAgentToolJson({
      storePath: context.storePath,
      activeSpace: activeSpace
        ? { id: activeSpace.id, name: activeSpace.name }
        : null,
      activePage: activePage
        ? { id: activePage.id, title: activePage.title, kind: activePage.kind }
        : null,
      totalPages: store.pages.length,
      wikiPages: store.pages.filter(page => page.kind === 'wiki').length,
      notes: store.pages.filter(page => page.kind === 'note').length,
      spaces: store.spaces.map(space => ({
        id: space.id,
        name: space.name,
        pages: store.pages.filter(page => page.spaceId === space.id).length,
      })),
      note: 'Ground space and page references here, then searchKnowledge/readKnowledgePage for content.',
    }),
  }
}

export function searchKnowledgeHandler(
  context: KnowledgeAgentToolContext,
  args: Record<string, unknown>,
): AgentToolHandlerResult {
  const fullStore = requireStore(context)
  if ('error' in fullStore) return agentToolErrorContent(fullStore.error)
  const spaceRef = readAgentToolStringArg(args, 'space')
  const space = spaceRef ? spaceByRef(fullStore, spaceRef) : undefined
  if (spaceRef && !space) {
    return agentToolErrorContent(
      `No space matching "${spaceRef}". listSpaces names them.`,
    )
  }
  const store: KnowledgeStore = space
    ? {
        ...fullStore,
        pages: fullStore.pages.filter(page => page.spaceId === space.id),
      }
    : fullStore
  const query = readAgentToolStringArg(args, 'query') ?? ''
  const rawLimit = args.limit
  const limit =
    typeof rawLimit === 'number' && Number.isFinite(rawLimit)
      ? Math.max(1, Math.min(25, Math.floor(rawLimit)))
      : 10
  const hits = rankKnowledgePages(store, query, limit)
  return {
    content: formatAgentToolJson({
      query: query || null,
      totalPages: store.pages.length,
      spaces: store.spaces.map(space => ({ id: space.id, name: space.name })),
      pages: hits.map(hit => ({
        id: hit.page.id,
        title: hit.page.title,
        kind: hit.page.kind,
        spaceId: hit.page.spaceId,
        tags: hit.page.tags,
        updatedAt: hit.page.updatedAt,
        snippet: hit.snippet,
      })),
      note: query
        ? 'Read a page in full with readKnowledgePage.'
        : 'No query given — these are the most recently updated pages.',
    }),
  }
}

export function readKnowledgePageHandler(
  context: KnowledgeAgentToolContext,
  args: Record<string, unknown>,
): AgentToolHandlerResult {
  const store = requireStore(context)
  if ('error' in store) return agentToolErrorContent(store.error)
  const ref = readAgentToolStringArg(args, 'page')
  if (!ref?.trim()) {
    return agentToolErrorContent(
      'Pass "page": a page id, slug, title, or alias. searchKnowledge lists them.',
    )
  }
  const page = pageByRef(store, ref)
  if (!page) {
    return agentToolErrorContent(
      `No page matching "${ref}". searchKnowledge finds pages by content.`,
    )
  }
  return {
    content: formatAgentToolJson({
      id: page.id,
      title: page.title,
      kind: page.kind,
      spaceId: page.spaceId,
      tags: page.tags,
      aliases: page.aliases ?? [],
      links: page.links,
      updatedAt: page.updatedAt,
      backlinks: findWikiBacklinks(store, page).map(source => ({
        id: source.id,
        title: source.title,
      })),
      body: page.body,
    }),
  }
}

export function listSpacesHandler(
  context: KnowledgeAgentToolContext,
): AgentToolHandlerResult {
  const store = requireStore(context)
  if ('error' in store) return agentToolErrorContent(store.error)
  return {
    content: formatAgentToolJson({
      activeSpaceId: store.activeSpaceId,
      spaces: store.spaces.map(space => ({
        id: space.id,
        name: space.name,
        description: space.description,
        pages: store.pages.filter(page => page.spaceId === space.id).length,
      })),
    }),
  }
}

export function getBacklinksHandler(
  context: KnowledgeAgentToolContext,
  args: Record<string, unknown>,
): AgentToolHandlerResult {
  const store = requireStore(context)
  if ('error' in store) return agentToolErrorContent(store.error)
  const ref = readAgentToolStringArg(args, 'page')
  if (!ref?.trim()) {
    return agentToolErrorContent(
      'Pass "page": a page id, slug, title, or alias.',
    )
  }
  const page = pageByRef(store, ref)
  if (!page) {
    return agentToolErrorContent(`No page matching "${ref}".`)
  }
  const backlinks = findWikiBacklinks(store, page)
  return {
    content: formatAgentToolJson({
      page: { id: page.id, title: page.title },
      backlinks: backlinks.map(source => ({
        id: source.id,
        title: source.title,
        kind: source.kind,
        updatedAt: source.updatedAt,
      })),
      note: backlinks.length
        ? undefined
        : 'Nothing links to this page — consider whether it is findable.',
    }),
  }
}

export function listKnowledgeActivityHandler(
  context: KnowledgeAgentToolContext,
  args: Record<string, unknown>,
): AgentToolHandlerResult {
  const store = requireStore(context)
  if ('error' in store) return agentToolErrorContent(store.error)
  const ref = readAgentToolStringArg(args, 'page')
  const page = ref ? pageByRef(store, ref) : undefined
  if (ref && !page) {
    return agentToolErrorContent(`No page matching "${ref}".`)
  }
  const rawLimit = args.limit
  const limit =
    typeof rawLimit === 'number' && Number.isFinite(rawLimit)
      ? Math.max(1, Math.min(100, Math.floor(rawLimit)))
      : 25
  const entries = store.activity
    .filter(entry => !page || entry.pageId === page.id)
    .slice(0, limit)
  return {
    content: formatAgentToolJson({
      entries: entries.map(entry => ({
        at: entry.at,
        type: entry.type,
        text: entry.text,
        actorType: entry.actorType ?? 'human',
        actorName: entry.actorName,
        pageId: entry.pageId,
      })),
    }),
  }
}

export function reviewKnowledgeHandler(
  context: KnowledgeAgentToolContext,
  args: Record<string, unknown>,
): AgentToolHandlerResult {
  const store = requireStore(context)
  if ('error' in store) return agentToolErrorContent(store.error)
  const spaceRef = readAgentToolStringArg(args, 'space')
  const space = spaceRef ? spaceByRef(store, spaceRef) : undefined
  if (spaceRef && !space) {
    return agentToolErrorContent(
      `No space matching "${spaceRef}". listSpaces names them.`,
    )
  }
  const spaceId = space?.id ?? store.activeSpaceId
  const findings = reviewKnowledgeStore(store, spaceId, Date.now())
  return {
    content: formatAgentToolJson({
      spaceId,
      findings,
      note: 'Findings are observations. Apply the fixes worth making with applyKnowledgeChange (update, rename, merge, delete) — safe repairs directly, destructive ones at the user\'s direction — and leave the rest alone.',
    }),
  }
}

const PROPOSAL_ACTIONS = [
  'create',
  'update',
  'rename',
  'promote',
  'delete',
  'merge',
] as const
type ProposalAction = (typeof PROPOSAL_ACTIONS)[number]

export async function applyKnowledgeChangeHandler(
  context: KnowledgeAgentToolContext,
  args: Record<string, unknown>,
): Promise<AgentToolHandlerResult> {
  const store = requireStore(context)
  if ('error' in store) return agentToolErrorContent(store.error)

  const summary = readAgentToolStringArg(args, 'summary')
  if (!summary?.trim()) {
    return agentToolErrorContent(
      'Pass "summary": one sentence on why this change is worth making.',
    )
  }

  const pageRef = readAgentToolStringArg(args, 'page')
  const existing = pageRef ? pageByRef(store, pageRef) : undefined
  if (pageRef && !existing) {
    return agentToolErrorContent(
      `No page matching "${pageRef}". searchKnowledge lists pages.`,
    )
  }

  const actionArg = readAgentToolStringArg(args, 'action')
  if (
    actionArg &&
    !PROPOSAL_ACTIONS.includes(actionArg as ProposalAction)
  ) {
    return agentToolErrorContent(
      `action must be one of ${PROPOSAL_ACTIONS.join(', ')}.`,
    )
  }
  const action: ProposalAction =
    (actionArg as ProposalAction | undefined) ??
    (existing ? 'update' : 'create')

  if (action !== 'create' && !existing) {
    return agentToolErrorContent(
      `action "${action}" needs "page" naming an existing page.`,
    )
  }

  const body = readAgentToolStringArg(args, 'body')
  if ((action === 'create' || action === 'update') && !body?.trim()) {
    return agentToolErrorContent('Pass "body": the page content (markdown).')
  }

  const titleArg = readAgentToolStringArg(args, 'title')?.trim()
  const title = titleArg || existing?.title
  if (!title) {
    return agentToolErrorContent('Pass "title" for the proposed page.')
  }
  if (action === 'rename' && (!titleArg || titleArg === existing?.title)) {
    return agentToolErrorContent(
      'action "rename" needs "title": the new page title.',
    )
  }
  if (action === 'promote' && existing?.kind !== 'note') {
    return agentToolErrorContent(
      `"${existing?.title}" is already a wiki page; only notes are promoted.`,
    )
  }

  const intoRef = readAgentToolStringArg(args, 'into')
  const mergeInto = intoRef ? pageByRef(store, intoRef) : undefined
  if (action === 'merge') {
    if (!mergeInto) {
      return agentToolErrorContent(
        'action "merge" needs "into": the surviving page, and "body": its merged content.',
      )
    }
    if (!body?.trim()) {
      return agentToolErrorContent(
        'action "merge" needs "body": the surviving page\'s merged content.',
      )
    }
    if (mergeInto.id === existing?.id) {
      return agentToolErrorContent('A page cannot merge into itself.')
    }
  }

  const parentRef = readAgentToolStringArg(args, 'parent')
  const parent = parentRef ? pageByRef(store, parentRef) : undefined
  if (parentRef && !parent) {
    return agentToolErrorContent(
      `No page matching "${parentRef}" to file this under. searchKnowledge lists pages.`,
    )
  }
  const kindArg = readAgentToolStringArg(args, 'kind')
  if (kindArg && kindArg !== 'wiki' && kindArg !== 'note') {
    return agentToolErrorContent('kind must be "wiki" or "note".')
  }
  // Duplicate guard: creating a page whose title an existing page already
  // carries is how a knowledge base rots — update that page instead.
  if (action === 'create') {
    const collision = store.pages.find(
      page => page.title.toLowerCase() === title.toLowerCase(),
    )
    if (collision) {
      return agentToolErrorContent(
        `A page titled "${collision.title}" already exists. Pass it as "page" with action "update" instead of creating a duplicate.`,
      )
    }
  }
  const tags = readAgentToolStringArg(args, 'tags')
    ?.split(',')
    .map(tag => tag.trim())
    .filter(Boolean)
  const links = readLinksArg(args)
  const changeType: KnowledgeAgentChangeType =
    action === 'create' ? 'page.create' : (`page.${action}` as const)
  const spaceId =
    existing?.spaceId ??
    store.activeSpaceId ??
    store.spaces[0]?.id
  if (!spaceId) {
    return agentToolErrorContent('The knowledge base has no space yet.')
  }
  const agentName =
    readAgentToolStringArg(args, 'agentName')?.trim() || 'Assistant'

  const before =
    action === 'merge' ? mergeInto?.body : existing?.body
  const after =
    action === 'delete'
      ? ''
      : action === 'rename' || action === 'promote'
        ? existing?.body
        : body ?? undefined

  const next = applyKnowledgeAgentChange(store, {
    spaceId: parent?.spaceId ?? spaceId,
    ...(existing ? { pageId: existing.id } : {}),
    agentName,
    changeType,
    title,
    summary: summary.trim(),
    ...(before !== undefined ? { before } : {}),
    ...(after !== undefined ? { after } : {}),
    patch: {
      title,
      ...(body?.trim() ? { body } : {}),
      ...(tags?.length ? { tags } : {}),
      ...(parent ? { parentId: parent.id } : {}),
      ...(kindArg ? { kind: kindArg as 'wiki' | 'note' } : {}),
      ...(links?.length ? { links } : {}),
      ...(mergeInto ? { mergeIntoPageId: mergeInto.id } : {}),
    },
  })
  await context.saveStore(next)
  void recordOperation({
    lane: 'agent',
    kind: `knowledge.${changeType}`,
    appSlug: KNOWLEDGE_APP_SLUG,
    summary: `${agentName}: ${summary.trim()}`,
    detail: `${changeType} "${title}"${mergeInto ? ` into "${mergeInto.title}"` : ''}`,
  }).catch(() => undefined)
  return {
    content: formatAgentToolJson({
      applied: changeType,
      title,
      ...(mergeInto ? { into: mergeInto.title } : {}),
      status: 'applied',
      storePath: context.storePath,
      artifactPaths: [context.storePath],
      note: 'Written to the wiki and recorded in the agent log with before/after.',
    }),
  }
}

export function listKnowledgeChangesHandler(
  context: KnowledgeAgentToolContext,
  args: Record<string, unknown>,
): AgentToolHandlerResult {
  const store = requireStore(context)
  if ('error' in store) return agentToolErrorContent(store.error)
  const rawLimit = args.limit
  const limit =
    typeof rawLimit === 'number' && Number.isFinite(rawLimit)
      ? Math.max(1, Math.min(100, Math.floor(rawLimit)))
      : 25
  const changes = (store.agentChanges ?? []).slice(0, limit)
  return {
    content: formatAgentToolJson({
      changes: changes.map(change => ({
        title: change.title,
        changeType: change.changeType,
        status: change.status,
        agentName: change.agentName,
        at: change.proposedAt,
        summary: change.summary,
        pageId: change.pageId,
      })),
      note: 'The agent log: every agent write with its before/after, newest first. Check it before repeating work another agent already did.',
    }),
  }
}
