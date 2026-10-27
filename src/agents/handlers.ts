import { guidanceMetadata, GUIDANCE_FILTERS, type GuidanceFilter, type GuidancePatch } from '../lib/knowledgeGuidance'
import {
  agentToolErrorContent,
  formatAgentToolJson,
  readAgentToolStringArg,
} from '@purescience/platform-ui/bridge/agentToolHelpers'
import type { AgentToolHandlerResult } from '@purescience/platform-ui/bridge/react/usePlatformAgentTools'
import { recordOperation } from '../bridge/platformBridge'
import {
  importKnowledgeImages,
  type KnowledgeImageImport,
} from '../bridge/knowledgeAssets'
import { KNOWLEDGE_APP_SLUG } from '../constants'
import {
  applyKnowledgeAgentChange,
  findWikiBacklinks,
  rankKnowledgePages,
  reviewKnowledgeStore,
  wouldCreateParentCycle,
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
): KnowledgePage | { error: string } | undefined {
  const trimmed = ref.trim()
  const byId = store.pages.find(page => page.id === trimmed)
  if (byId) return byId
  const lowered = trimmed.toLowerCase()
  const exact = store.pages.filter(
    page =>
      page.title.toLowerCase() === lowered ||
      (page.aliases ?? []).some(alias => alias.toLowerCase() === lowered),
  )
  const candidates = exact.length
    ? exact
    : store.pages.filter(page => page.slug.toLowerCase() === lowered)
  const active = candidates.filter(page => page.spaceId === store.activeSpaceId)
  const matches = active.length ? active : candidates
  if (matches.length > 1) {
    return {
      error: `"${ref}" matches multiple pages (${matches.map(page => `${page.title}: ${page.id}`).join(', ')}). Use its page id.`,
    }
  }
  return matches[0]
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

function readImportAssetsArg(
  args: Record<string, unknown>,
): KnowledgeImageImport[] | { error: string } | undefined {
  const raw = args.importAssets
  if (raw === undefined) return undefined
  if (!Array.isArray(raw)) {
    return { error: '"importAssets" must be an array of local images; use [] for a text-only change.' }
  }
  if (raw.length > 100) {
    return { error: 'Import at most 100 images in one call.' }
  }
  const images: KnowledgeImageImport[] = []
  for (const [index, item] of raw.entries()) {
    if (!item || typeof item !== 'object') {
      return { error: `importAssets[${index}] must be an object.` }
    }
    const candidate = item as Record<string, unknown>
    const sourcePath =
      typeof candidate.sourcePath === 'string'
        ? candidate.sourcePath.trim()
        : ''
    if (!sourcePath.startsWith('/')) {
      return {
        error: `importAssets[${index}].sourcePath must be an absolute local path.`,
      }
    }
    const alt =
      typeof candidate.alt === 'string' ? candidate.alt.trim() : undefined
    images.push({ sourcePath, ...(alt ? { alt } : {}) })
  }
  return images
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
        ? { id: activePage.id, title: activePage.title, kind: activePage.kind, ...guidanceMetadata(activePage) }
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
  if (args.status !== undefined && !GUIDANCE_FILTERS.includes(args.status as GuidanceFilter)) return agentToolErrorContent('status must be all, unmarked, draft, current or retired.')
  const hits = rankKnowledgePages(store, query, limit, args.status as GuidanceFilter | undefined)
  return {
    content: formatAgentToolJson({
      query: query || null,
      totalPages: store.pages.length,
      spaces: store.spaces.map(space => ({ id: space.id, name: space.name })),
      pages: hits.map(hit => ({
        ...guidanceMetadata(hit.page),
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
        : 'No query given — Current guidance first, then other status groups, newest within each group.',
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
  if (page && 'error' in page) return agentToolErrorContent(page.error)
  if (!page) {
    return agentToolErrorContent(
      `No page matching "${ref}". searchKnowledge finds pages by content.`,
    )
  }
  const part = readPagePart(page.body, args)
  if ('error' in part) return agentToolErrorContent(part.error)
  return {
    content: formatAgentToolJson({
      id: page.id,
      title: page.title,
      kind: page.kind,
      spaceId: page.spaceId,
      tags: page.tags,
      ...guidanceMetadata(page),
      aliases: page.aliases ?? [],
      links: page.links,
      updatedAt: page.updatedAt,
      backlinks: findWikiBacklinks(store, page).map(source => ({
        id: source.id,
        title: source.title,
      })),
      ...part,
    }),
  }
}

/** Markdown headings of a page body with their character offsets. */
function pageHeadings(body: string) {
  const headings: { heading: string; level: number; offset: number }[] = []
  let offset = 0
  let fence: '`' | '~' | null = null
  for (const rawLine of body.split('\n')) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
    const fenceMatch = /^[ \t]{0,3}(`{3,}|~{3,})/.exec(line)
    if (fenceMatch) {
      const marker = fenceMatch[1]![0] as '`' | '~'
      fence = fence === marker ? null : fence ?? marker
    } else if (!fence) {
      const match = /^(#{1,6})[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/.exec(line)
      if (match) {
        headings.push({ heading: match[2]!.trim(), level: match[1]!.length, offset })
      }
    }
    offset += rawLine.length + 1
  }
  return headings
}

/**
 * The whole body by default (unchanged). With `section` (a heading) or
 * `offset`/`maxChars`, only that part, plus the page's total length, its
 * headings and the next offset (within the section, when one is named), so a
 * long page can be read in pieces.
 */
function readPagePart(
  body: string,
  args: Record<string, unknown>,
): { body: string } | { body: string; bodyCharacters: number; offset: number; nextOffset: number | null; sections: { heading: string; level: number; offset: number }[]; moreSections?: number; section?: string } | { error: string } {
  const section = readAgentToolStringArg(args, 'section')?.trim()
  const rawOffset = args.offset
  const rawMax = args.maxChars
  if (!section && rawOffset === undefined && rawMax === undefined) return { body }
  if (rawOffset !== undefined && (typeof rawOffset !== 'number' || !Number.isInteger(rawOffset) || rawOffset < 0)) {
    return { error: '"offset" must be a whole number of characters, 0 or more.' }
  }
  if (rawMax !== undefined && (typeof rawMax !== 'number' || !Number.isInteger(rawMax) || rawMax < 1)) {
    return { error: '"maxChars" must be a whole number of characters, 1 or more.' }
  }
  const headings = pageHeadings(body)
  let start = 0
  let end = body.length
  if (section) {
    const lowered = section.replace(/^#+\s*/, '').toLowerCase()
    const index = headings.findIndex(h => h.heading.toLowerCase() === lowered)
    if (index < 0) {
      return { error: `No heading "${section}" on this page. Headings: ${headings.map(h => h.heading).join(', ') || 'none'}.` }
    }
    const found = headings[index]!
    start = found.offset
    const next = headings.slice(index + 1).find(h => h.level <= found.level)
    end = next ? next.offset : body.length
  }
  // offset is always a position in the whole body, so nextOffset can be passed straight back.
  start = Math.min(end, Math.max(start, (rawOffset as number | undefined) ?? 0))
  const stop = rawMax === undefined ? end : Math.min(end, start + (rawMax as number))
  return {
    body: body.slice(start, stop),
    bodyCharacters: body.length,
    offset: start,
    nextOffset: stop < end ? stop : null,
    sections: headings.slice(0, 50),
    ...(headings.length > 50 ? { moreSections: headings.length - 50 } : {}),
    ...(section ? { section } : {}),
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
  if (page && 'error' in page) return agentToolErrorContent(page.error)
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
  if (page && 'error' in page) return agentToolErrorContent(page.error)
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
  'guidance',
  'check',
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
  if (existing && 'error' in existing) return agentToolErrorContent(existing.error)
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
  const existingIsRoot = existing
    ? store.spaces.some(space => space.rootPageId === existing.id)
    : false
  if (existingIsRoot && (action === 'delete' || action === 'merge')) {
    return agentToolErrorContent(
      `"${existing?.title}" is a space root and cannot be deleted or merged away.`,
    )
  }

  if (action === 'guidance' || action === 'check') {
    const agentName = readAgentToolStringArg(args, 'agentName')?.trim() || 'Assistant'
    const patch: GuidancePatch = action === 'check'
      ? { lastChecked: { actorType: 'agent', actorName: agentName, at: args.checkedAt as string } }
      : {
          ...(args.guidanceStatus !== undefined ? { guidanceStatus: args.guidanceStatus as GuidancePatch['guidanceStatus'] } : {}),
          ...(args.replacementPageId !== undefined ? { replacementPageId: args.replacementPageId as string | null } : {}),
        }
    if (action === 'guidance' && !Object.keys(patch).length) return agentToolErrorContent('Pass guidanceStatus or replacementPageId (null clears it).')
    try {
      await context.saveStore(current => {
        const page = current.pages.find(candidate => candidate.id === existing!.id)
        if (!page) throw new Error('Page no longer available; search again.')
        return applyKnowledgeAgentChange(current, {
          spaceId: page.spaceId, pageId: page.id, agentName, changeType: 'page.update', title: page.title,
          summary: summary.trim(), before: JSON.stringify(guidanceMetadata(page)),
          after: JSON.stringify({ ...guidanceMetadata(page), ...patch }), patch,
        })
      })
      void recordOperation({ lane: 'agent', kind: 'knowledge.page.update', appSlug: KNOWLEDGE_APP_SLUG, summary: `${agentName}: ${summary.trim()}` }).catch(() => undefined)
      return { content: formatAgentToolJson({ applied: action, pageId: existing!.id }) }
    } catch (error) { return agentToolErrorContent(error instanceof Error ? error.message : String(error)) }
  }

  const body = readAgentToolStringArg(args, 'body')
  const importAssets = readImportAssetsArg(args)
  if (importAssets && 'error' in importAssets) {
    return agentToolErrorContent(importAssets.error)
  }
  if (
    (action === 'create' || action === 'update') &&
    !body?.trim() &&
    !importAssets?.length
  ) {
    return agentToolErrorContent(
      'Pass "body": the page content (markdown), or "importAssets": local images to append.',
    )
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
  const resolvedMergeInto = intoRef ? pageByRef(store, intoRef) : undefined
  if (action === 'merge') {
    if (resolvedMergeInto && 'error' in resolvedMergeInto) return agentToolErrorContent(resolvedMergeInto.error)
    if (!resolvedMergeInto) {
      return agentToolErrorContent(
        'action "merge" needs "into": the surviving page, and "body": its merged content.',
      )
    }
    if (!body?.trim()) {
      return agentToolErrorContent(
        'action "merge" needs "body": the surviving page\'s merged content.',
      )
    }
    if (resolvedMergeInto.id === existing?.id) {
      return agentToolErrorContent('A page cannot merge into itself.')
    }
    if (existing && wouldCreateParentCycle(store, existing.id, resolvedMergeInto.id)) {
      return agentToolErrorContent(
        'A page cannot merge into its own descendant because that would delete the surviving page.',
      )
    }
  }
  const mergeInto: KnowledgePage | undefined =
    resolvedMergeInto && !('error' in resolvedMergeInto) ? resolvedMergeInto : undefined

  const parentRef = readAgentToolStringArg(args, 'parent')
  const parent = parentRef ? pageByRef(store, parentRef) : undefined
  if (parent && 'error' in parent) return agentToolErrorContent(parent.error)
  if (parentRef && !parent) {
    return agentToolErrorContent(
      `No page matching "${parentRef}" to file this under. searchKnowledge lists pages.`,
    )
  }
  if (existing && parent && parent.spaceId !== existing.spaceId) {
    return agentToolErrorContent(
      `"${existing.title}" cannot be filed under a page from another space.`,
    )
  }
  if (existing && parent && wouldCreateParentCycle(store, existing.id, parent.id)) {
    return agentToolErrorContent(
      `"${existing.title}" cannot be filed under itself or one of its own pages.`,
    )
  }
  const kindArg = readAgentToolStringArg(args, 'kind')
  if (kindArg && kindArg !== 'wiki' && kindArg !== 'note') {
    return agentToolErrorContent('kind must be "wiki" or "note".')
  }
  if (existingIsRoot && kindArg === 'note') {
    return agentToolErrorContent(
      `"${existing?.title}" is a space root and must remain a wiki page.`,
    )
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
  const tags = typeof args.tags === 'string'
    ? args.tags.split(',').map(tag => tag.trim()).filter(Boolean)
    : Array.isArray(args.tags)
      ? args.tags
          .filter((tag): tag is string => typeof tag === 'string')
          .map(tag => tag.trim())
          .filter(Boolean)
      : undefined
  const links = readLinksArg(args)
  if (importAssets?.length && action !== 'create' && action !== 'update') {
    return agentToolErrorContent(
      '"importAssets" is supported with action "create" or "update".',
    )
  }
  let importedAssets: Awaited<ReturnType<typeof importKnowledgeImages>> = []
  if (importAssets?.length) {
    try {
      importedAssets = await importKnowledgeImages(context.storePath, importAssets)
    } catch (error) {
      return agentToolErrorContent(
        error instanceof Error ? error.message : String(error),
      )
    }
  }
  const importedMarkdown = importedAssets
    .map(asset => asset.markdown)
    .join('\n\n')
  const effectiveLinks: Partial<KnowledgeLink>[] = [
    ...(links ?? []),
    ...importedAssets.map(asset => ({
      type: 'file' as const,
      title: asset.alt,
      path: asset.absolutePath,
    })),
  ]
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

  try {
    await context.saveStore(current => {
      const currentExisting = existing
        ? current.pages.find(page => page.id === existing.id)
        : undefined
      if (existing && !currentExisting) {
        throw new Error(`"${existing.title}" was removed before this change could be applied; find its replacement and retry.`)
      }
      if (action === 'create') {
        const collision = current.pages.find(
          page => page.title.toLowerCase() === title.toLowerCase(),
        )
        if (collision) throw new Error(`A page titled "${collision.title}" already exists; update it instead.`)
      }
      const currentMergeInto = mergeInto
        ? current.pages.find(page => page.id === mergeInto.id)
        : undefined
      if (mergeInto && !currentMergeInto) {
        throw new Error(`The merge destination "${mergeInto.title}" no longer exists; choose a surviving page and retry.`)
      }
      const currentParent = parent
        ? current.pages.find(page => page.id === parent.id)
        : undefined
      if (parent && !currentParent) {
        throw new Error(`The parent page "${parent.title}" no longer exists; choose a parent and retry.`)
      }
      const baseBody = body?.trim() ?? (action === 'update' ? currentExisting?.body : '')
      const effectiveBody = [baseBody, importedMarkdown].filter(Boolean).join('\n\n')
      const before = action === 'merge' ? currentMergeInto?.body : currentExisting?.body
      const after = action === 'delete'
        ? ''
        : action === 'rename' || action === 'promote'
          ? currentExisting?.body
          : effectiveBody || undefined
      return applyKnowledgeAgentChange(current, {
        spaceId: currentParent?.spaceId ?? spaceId,
        ...(currentExisting ? { pageId: currentExisting.id } : {}),
        agentName,
        changeType,
        title: !titleArg && currentExisting ? currentExisting.title : title,
        summary: summary.trim(),
        ...(before !== undefined ? { before } : {}),
        ...(after !== undefined ? { after } : {}),
        patch: {
          ...(action === 'create' || action === 'rename' || titleArg ? { title } : {}),
          ...(effectiveBody ? { body: effectiveBody } : {}),
          ...(tags !== undefined ? { tags } : {}),
          ...(currentParent ? { parentId: currentParent.id } : {}),
          ...(kindArg ? { kind: kindArg as 'wiki' | 'note' } : {}),
          ...(effectiveLinks.length ? { links: effectiveLinks } : {}),
          ...(currentMergeInto ? { mergeIntoPageId: currentMergeInto.id } : {}),
        },
      })
    })
  } catch (error) {
    return agentToolErrorContent(error instanceof Error ? error.message : String(error))
  }
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
      ...(importedAssets.length
        ? {
            importedAssets: importedAssets.map(asset => ({
              sourcePath: asset.sourcePath,
              path: asset.absolutePath,
              relativePath: asset.relativePath,
              markdown: asset.markdown,
            })),
          }
        : {}),
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
