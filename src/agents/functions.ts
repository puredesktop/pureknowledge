import {
  defineAppFunction,
  type AppFunctionDefinition,
} from '@purescience/platform-ui/bridge/appFunctions'
import { readAgentToolStringArg } from '@purescience/platform-ui/bridge/agentToolHelpers'
import { recordOperation } from '../bridge/platformBridge'
import { KNOWLEDGE_APP_SLUG } from '../constants'
import {
  GUIDANCE_FILTERS,
  guidanceMetadata,
  type GuidanceFilter,
} from '../lib/knowledgeGuidance'
import {
  MEANING_MIN_QUERY,
  meaningSearchNote,
  rankKnowledgeWithMeaning,
} from '../lib/knowledgeMeaning'
import {
  applyKnowledgeAgentChange,
  extractWikiLinks,
  findPageByWikiTitle,
  findPagePath,
  findWikiBacklinks,
  KNOWLEDGE_STALE_AFTER_DAYS,
  rankKnowledgePages,
  reviewKnowledgeStore,
  wouldCreateParentCycle,
} from '../lib/knowledgeStore'
import type {
  KnowledgePage,
  KnowledgePageKind,
  KnowledgeStore,
} from '../lib/knowledgeTypes'
import { isPolicy, knowledgeStatus } from '../lib/organisationKnowledge.mjs'
import {
  AgentKnowledgeToolError,
  type KnowledgeAgentToolContext,
} from './catalog'
import {
  pageByRef,
  pageHeadings,
  safeEffectivePage,
  spaceByRef,
} from './handlers'

function requireLoadedStore(ctx: KnowledgeAgentToolContext): KnowledgeStore {
  if (!ctx.store) {
    throw new AgentKnowledgeToolError(
      'The knowledge base is still loading; try again shortly.',
    )
  }
  return ctx.store
}

function clampInt(
  raw: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return fallback
  return Math.max(min, Math.min(max, Math.floor(raw)))
}

function parseTagsArg(raw: unknown): string[] | undefined {
  if (typeof raw === 'string') {
    return raw
      .split(',')
      .map(tag => tag.trim())
      .filter(Boolean)
  }
  if (Array.isArray(raw)) {
    return raw
      .filter((tag): tag is string => typeof tag === 'string')
      .map(tag => tag.trim())
      .filter(Boolean)
  }
  return undefined
}

function mergeTags(existing: readonly string[], incoming: readonly string[]): string[] {
  const seen = new Set(existing.map(tag => tag.toLowerCase()))
  const merged = [...existing]
  for (const tag of incoming) {
    const key = tag.toLowerCase()
    if (!seen.has(key)) {
      seen.add(key)
      merged.push(tag)
    }
  }
  return merged
}

function countDescendants(store: KnowledgeStore, rootPageId: string): number {
  const childrenByParent = new Map<string, string[]>()
  for (const page of store.pages) {
    if (page.parentId) {
      const list = childrenByParent.get(page.parentId) ?? []
      list.push(page.id)
      childrenByParent.set(page.parentId, list)
    }
  }
  const visited = new Set<string>([rootPageId])
  const queue = [...(childrenByParent.get(rootPageId) ?? [])]
  let count = 0
  while (queue.length > 0) {
    const nextId = queue.shift()!
    if (visited.has(nextId)) continue
    visited.add(nextId)
    count += 1
    for (const childId of childrenByParent.get(nextId) ?? []) {
      if (!visited.has(childId)) queue.push(childId)
    }
  }
  return count
}

function resolveOutboundLinks(
  store: KnowledgeStore,
  spaceId: string,
  body: string,
) {
  return extractWikiLinks(body).map(target => {
    const resolved = findPageByWikiTitle(store, spaceId, target)
    return resolved
      ? {
          target,
          resolvedPageId: resolved.id,
          resolvedTitle: resolved.title,
          broken: false,
        }
      : {
          target,
          resolvedPageId: null,
          resolvedTitle: null,
          broken: true,
        }
  })
}

/**
 * 1. fn_researchTopic
 * Replaces: getKnowledgeContext + searchKnowledge + N × readKnowledgePage + getBacklinks + listKnowledgeChanges
 */
const fn_researchTopic = defineAppFunction<KnowledgeAgentToolContext>({
  name: 'fn_researchTopic',
  category: 'research',
  risk: 'read',
  requiresApproval: false,
  replaces: [
    'getKnowledgeContext',
    'searchKnowledge',
    'readKnowledgePage',
    'getBacklinks',
    'listKnowledgeChanges',
  ],
  description:
    'Research a topic across the knowledge base in one call: runs semantic and keyword search, hydrates the top matching pages with bounded excerpts, markdown headings, outbound wikilinks, backlinks, resource links, and guidance status, and includes recent agent edits touching those pages.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description:
          'Plain-language question, topic, or keywords to research across titles, aliases, tags, bodies, and links.',
      },
      space: {
        type: 'string',
        description: 'Optional space id or exact name to scope the research.',
      },
      status: {
        type: 'string',
        enum: ['all', 'unmarked', 'draft', 'current', 'retired'],
        description:
          'Optional guidance status filter; Current guidance ranks first within matching results.',
      },
      includeDrafts: {
        type: 'boolean',
        description:
          'Explicitly include working policy drafts and archived pages (default false: active published text only).',
      },
      maxPages: {
        type: 'integer',
        minimum: 1,
        maximum: 8,
        description:
          'Maximum number of top matching pages to hydrate with excerpts, headings, and link graphs (default 3).',
      },
      maxCharsPerPage: {
        type: 'integer',
        minimum: 200,
        maximum: 8000,
        description:
          'Maximum body characters returned per hydrated page (default 2500).',
      },
      includeRecentChanges: {
        type: 'boolean',
        description:
          'Include recent agent log entries touching any hydrated page (default true).',
      },
    },
    required: ['query'],
  },
  run: async (ctx, args) => {
    const fullStore = requireLoadedStore(ctx)
    const query = readAgentToolStringArg(args, 'query')?.trim() ?? ''
    if (!query) {
      throw new AgentKnowledgeToolError(
        'Pass "query": a topic or keywords to research in the knowledge base.',
      )
    }

    const spaceRef = readAgentToolStringArg(args, 'space')
    const scopedSpace = spaceRef ? spaceByRef(fullStore, spaceRef) : undefined
    if (spaceRef && !scopedSpace) {
      throw new AgentKnowledgeToolError(
        `No space matching "${spaceRef}". Available spaces: ${fullStore.spaces.map(s => s.name).join(', ') || 'none'}.`,
      )
    }

    if (
      args.status !== undefined &&
      !GUIDANCE_FILTERS.includes(args.status as GuidanceFilter)
    ) {
      throw new AgentKnowledgeToolError(
        'status must be all, unmarked, draft, current or retired.',
      )
    }
    const status = args.status as GuidanceFilter | undefined
    const includeDrafts = args.includeDrafts === true
    const maxPages = clampInt(args.maxPages, 3, 1, 8)
    const maxCharsPerPage = clampInt(args.maxCharsPerPage, 2500, 200, 8000)
    const includeRecentChanges = args.includeRecentChanges !== false

    const scopedStore: KnowledgeStore = scopedSpace
      ? {
          ...fullStore,
          pages: fullStore.pages.filter(p => p.spaceId === scopedSpace.id),
        }
      : fullStore

    const effectivePages: KnowledgePage[] = []
    for (const page of scopedStore.pages) {
      if (page.governance?.archived && !includeDrafts) continue
      const resolved = safeEffectivePage(page, includeDrafts)
      if (resolved.page) effectivePages.push(resolved.page)
    }
    const effectiveStore: KnowledgeStore = {
      ...scopedStore,
      pages: effectivePages,
    }

    const searchLimit = Math.min(25, Math.max(10, maxPages * 3))
    const meaningIndex =
      query.length >= MEANING_MIN_QUERY ? (ctx.meaning?.index() ?? null) : null
    const queryVector = meaningIndex
      ? ((await ctx.meaning?.vector(query).catch(() => null)) ?? null)
      : null
    const byMeaning =
      meaningIndex && queryVector
        ? rankKnowledgeWithMeaning(
            effectiveStore,
            query,
            searchLimit,
            status,
            meaningIndex,
            queryVector,
            { drafts: includeDrafts },
          )
        : null
    const hits: Array<{
      page: KnowledgePage
      snippet: string
      matched?: string
    }> = byMeaning ?? rankKnowledgePages(effectiveStore, query, searchLimit, status)
    const readiness = ctx.meaning?.readiness() ?? {
      state: 'unsupported' as const,
    }
    const searchNote =
      query.length < MEANING_MIN_QUERY
        ? null
        : (meaningSearchNote(readiness) ??
          (byMeaning ? null : meaningSearchNote({ state: 'failed' })))

    const spaceNameById = new Map(fullStore.spaces.map(s => [s.id, s.name]))
    const rawPageById = new Map(fullStore.pages.map(p => [p.id, p]))

    const topHits = hits.slice(0, maxPages)
    const hydratedPages = topHits.map(hit => {
      const effective = hit.page
      const raw = rawPageById.get(effective.id) ?? effective
      const headings = pageHeadings(effective.body)
      const truncated = effective.body.length > maxCharsPerPage
      const bodyExcerpt = truncated
        ? effective.body.slice(0, maxCharsPerPage)
        : effective.body
      const backlinks = findWikiBacklinks(fullStore, raw).map(src => ({
        id: src.id,
        title: src.title,
        kind: src.kind,
      }))
      const outboundLinks = resolveOutboundLinks(
        fullStore,
        raw.spaceId,
        effective.body,
      )
      return {
        id: raw.id,
        title: effective.title,
        slug: raw.slug,
        kind: effective.kind,
        status: knowledgeStatus(raw),
        spaceId: raw.spaceId,
        spaceName: spaceNameById.get(raw.spaceId) ?? null,
        tags: effective.tags,
        aliases: raw.aliases ?? [],
        ...guidanceMetadata(raw),
        updatedAt: raw.updatedAt,
        ...(hit.matched ? { matched: hit.matched } : {}),
        snippet: hit.snippet,
        body: bodyExcerpt,
        bodyCharacters: effective.body.length,
        truncated,
        sections: headings.slice(0, 30),
        outboundLinks,
        backlinks,
        resourceLinks: effective.links,
      }
    })

    const additionalMatches = hits.slice(maxPages).map(hit => ({
      id: hit.page.id,
      title: hit.page.title,
      kind: hit.page.kind,
      spaceId: hit.page.spaceId,
      ...guidanceMetadata(rawPageById.get(hit.page.id) ?? hit.page),
      updatedAt: hit.page.updatedAt,
      snippet: hit.snippet,
      ...(hit.matched ? { matched: hit.matched } : {}),
    }))

    const hydratedIds = new Set(hydratedPages.map(p => p.id))
    const relatedRecentChanges = includeRecentChanges
      ? (fullStore.agentChanges ?? [])
          .filter(change => change.pageId && hydratedIds.has(change.pageId))
          .slice(0, 10)
          .map(change => ({
            pageId: change.pageId,
            title: change.title,
            changeType: change.changeType,
            agentName: change.agentName,
            at: change.proposedAt,
            summary: change.summary,
          }))
      : []

    return {
      mutated: false,
      summary: `Researched "${query}": ${hits.length} matching page${hits.length === 1 ? '' : 's'} (${hydratedPages.length} hydrated).`,
      data: {
        query,
        searchedBy: byMeaning ? 'meaning-and-words' : 'words',
        ...(searchNote ? { searchNote } : {}),
        scopeSpace: scopedSpace
          ? { id: scopedSpace.id, name: scopedSpace.name }
          : null,
        totalMatches: hits.length,
        hydratedCount: hydratedPages.length,
        pages: hydratedPages,
        additionalMatches,
        relatedRecentChanges,
      },
    }
  },
})

/**
 * 2. fn_knowledgeHealthAudit
 * Replaces: getKnowledgeContext + listSpaces + reviewKnowledge + getBacklinks + listKnowledgeActivity + listKnowledgeChanges
 */
const fn_knowledgeHealthAudit = defineAppFunction<KnowledgeAgentToolContext>({
  name: 'fn_knowledgeHealthAudit',
  category: 'curation',
  risk: 'read',
  requiresApproval: false,
  replaces: [
    'getKnowledgeContext',
    'listSpaces',
    'reviewKnowledge',
    'getBacklinks',
    'listKnowledgeActivity',
    'listKnowledgeChanges',
  ],
  description:
    'Audit knowledge-base health across one space or all spaces in one call: aggregates space totals, guidance status coverage, broken wikilinks, orphan pages, stale pages, duplicate titles, backlink counts, kept copies, and recent human and agent activity.',
  inputSchema: {
    type: 'object',
    properties: {
      space: {
        type: 'string',
        description:
          'Optional space id, exact name, or "active" to audit one space; omit to audit every space in the library.',
      },
      staleDays: {
        type: 'integer',
        minimum: 1,
        maximum: 3650,
        description: `Days without an update before a page is flagged stale (default ${KNOWLEDGE_STALE_AFTER_DAYS}).`,
      },
      includeActivity: {
        type: 'boolean',
        description:
          'Include recent human/agent activity and recent agent writes (default true).',
      },
      activityLimit: {
        type: 'integer',
        minimum: 1,
        maximum: 50,
        description:
          'Maximum number of recent activity and agent-change entries to include (default 15).',
      },
    },
  },
  run: async (ctx, args) => {
    const store = requireLoadedStore(ctx)
    const spaceRef = readAgentToolStringArg(args, 'space')?.trim()
    let targetSpaces = store.spaces
    if (spaceRef) {
      if (spaceRef.toLowerCase() === 'active') {
        const active =
          store.spaces.find(s => s.id === store.activeSpaceId) ??
          store.spaces[0]
        targetSpaces = active ? [active] : []
      } else {
        const matched = spaceByRef(store, spaceRef)
        if (!matched) {
          throw new AgentKnowledgeToolError(
            `No space matching "${spaceRef}". Available spaces: ${store.spaces.map(s => s.name).join(', ') || 'none'}.`,
          )
        }
        targetSpaces = [matched]
      }
    }

    const staleDays = clampInt(
      args.staleDays,
      KNOWLEDGE_STALE_AFTER_DAYS,
      1,
      3650,
    )
    const includeActivity = args.includeActivity !== false
    const activityLimit = clampInt(args.activityLimit, 15, 1, 50)
    const nowMs = Date.now()
    const staleBefore = nowMs - staleDays * 24 * 60 * 60 * 1000

    const targetSpaceIds = new Set(targetSpaces.map(s => s.id))
    const scopedPages = store.pages.filter(p => targetSpaceIds.has(p.spaceId))
    const pageById = new Map(store.pages.map(p => [p.id, p]))

    const guidanceBreakdown = { current: 0, draft: 0, retired: 0, unmarked: 0 }
    let keptCopies = 0
    const retiredWithoutReplacement: Array<{
      id: string
      title: string
      spaceId: string
    }> = []
    const uncheckedCurrentPages: Array<{
      id: string
      title: string
      spaceId: string
      updatedAt: string
    }> = []

    for (const page of scopedPages) {
      if (page.governance?.archived) continue
      if (page.tags.includes('kept-copy')) keptCopies += 1
      const gs = page.guidanceStatus
      if (gs === 'current') {
        guidanceBreakdown.current += 1
        if (!page.lastChecked) {
          uncheckedCurrentPages.push({
            id: page.id,
            title: page.title,
            spaceId: page.spaceId,
            updatedAt: page.updatedAt,
          })
        }
      } else if (gs === 'draft') {
        guidanceBreakdown.draft += 1
      } else if (gs === 'retired') {
        guidanceBreakdown.retired += 1
        if (!page.replacementPageId) {
          retiredWithoutReplacement.push({
            id: page.id,
            title: page.title,
            spaceId: page.spaceId,
          })
        }
      } else {
        guidanceBreakdown.unmarked += 1
      }
    }

    const brokenLinks: Array<{
      spaceId: string
      pageId: string
      pageTitle: string
      detail: string
    }> = []
    const orphans: Array<{
      spaceId: string
      pageId: string
      pageTitle: string
      detail: string
      updatedAt: string
    }> = []
    const stalePages: Array<{
      spaceId: string
      pageId: string
      pageTitle: string
      detail: string
      updatedAt: string
    }> = []
    const duplicateTitles: Array<{
      spaceId: string
      pageId: string
      pageTitle: string
      detail: string
      backlinkCount: number
    }> = []

    const spaceSummaries = targetSpaces.map(space => {
      const spacePages = store.pages.filter(p => p.spaceId === space.id)
      const rawFindings = reviewKnowledgeStore(store, space.id, nowMs)
      const nonStaleFindings = rawFindings.filter(f => f.kind !== 'stale')

      let brokenCount = 0
      let orphanCount = 0
      let duplicateCount = 0
      for (const finding of nonStaleFindings) {
        const page = pageById.get(finding.pageId)
        if (finding.kind === 'brokenLink') {
          brokenCount += 1
          brokenLinks.push({ spaceId: space.id, ...finding })
        } else if (finding.kind === 'orphan') {
          orphanCount += 1
          orphans.push({
            spaceId: space.id,
            ...finding,
            updatedAt: page?.updatedAt ?? '',
          })
        } else if (finding.kind === 'duplicateTitle') {
          duplicateCount += 1
          duplicateTitles.push({
            spaceId: space.id,
            ...finding,
            backlinkCount: page ? findWikiBacklinks(store, page).length : 0,
          })
        }
      }

      let staleCount = 0
      for (const page of spacePages) {
        if (page.guidanceStatus === 'retired' || page.governance?.archived) {
          continue
        }
        const updated = Date.parse(page.updatedAt)
        if (Number.isFinite(updated) && updated < staleBefore) {
          staleCount += 1
          stalePages.push({
            spaceId: space.id,
            pageId: page.id,
            pageTitle: page.title,
            detail: `Not updated since ${page.updatedAt.slice(0, 10)}`,
            updatedAt: page.updatedAt,
          })
        }
      }

      return {
        id: space.id,
        name: space.name,
        description: space.description,
        isActive: space.id === store.activeSpaceId,
        pageCount: spacePages.length,
        wikiCount: spacePages.filter(p => p.kind === 'wiki').length,
        noteCount: spacePages.filter(p => p.kind === 'note').length,
        findingCounts: {
          brokenLink: brokenCount,
          orphan: orphanCount,
          stale: staleCount,
          duplicateTitle: duplicateCount,
        },
      }
    })

    const scopedPageIds = new Set(scopedPages.map(p => p.id))
    const recentActivity = includeActivity
      ? store.activity
          .filter(
            entry =>
              !spaceRef || !entry.pageId || scopedPageIds.has(entry.pageId),
          )
          .slice(0, activityLimit)
          .map(entry => ({
            at: entry.at,
            type: entry.type,
            text: entry.text,
            actorType: entry.actorType ?? 'human',
            actorName: entry.actorName,
            pageId: entry.pageId,
          }))
      : []

    const recentAgentChanges = includeActivity
      ? (store.agentChanges ?? [])
          .filter(change => targetSpaceIds.has(change.spaceId))
          .slice(0, activityLimit)
          .map(change => ({
            title: change.title,
            changeType: change.changeType,
            status: change.status,
            agentName: change.agentName,
            at: change.proposedAt,
            summary: change.summary,
            pageId: change.pageId,
            spaceId: change.spaceId,
          }))
      : []

    const totalFindings =
      brokenLinks.length +
      orphans.length +
      stalePages.length +
      duplicateTitles.length

    return {
      mutated: false,
      summary: `Audited ${targetSpaces.length} space${targetSpaces.length === 1 ? '' : 's'} (${scopedPages.length} pages): ${totalFindings} curation finding${totalFindings === 1 ? '' : 's'} (${brokenLinks.length} broken links, ${orphans.length} orphans, ${stalePages.length} stale, ${duplicateTitles.length} duplicates).`,
      data: {
        storePath: ctx.storePath,
        activeSpaceId: store.activeSpaceId,
        staleThresholdDays: staleDays,
        totals: {
          spaces: targetSpaces.length,
          totalPages: scopedPages.length,
          wikiPages: scopedPages.filter(p => p.kind === 'wiki').length,
          notes: scopedPages.filter(p => p.kind === 'note').length,
          guidanceBreakdown,
          keptCopies,
          totalFindings,
        },
        spaceSummaries,
        findings: {
          brokenLinks,
          orphans,
          stalePages,
          duplicateTitles,
        },
        guidanceAttention: {
          retiredWithoutReplacement,
          uncheckedCurrentPages,
        },
        recentActivity,
        recentAgentChanges,
      },
    }
  },
})

/**
 * 3. fn_inspectPageNeighborhood
 * Replaces: readKnowledgePage + getBacklinks + listKnowledgeActivity + listKnowledgeChanges + hierarchy lookup
 */
const fn_inspectPageNeighborhood = defineAppFunction<KnowledgeAgentToolContext>({
  name: 'fn_inspectPageNeighborhood',
  category: 'pages',
  risk: 'read',
  requiresApproval: false,
  replaces: [
    'readKnowledgePage',
    'getBacklinks',
    'listKnowledgeActivity',
    'listKnowledgeChanges',
  ],
  description:
    'Inspect a knowledge page together with its full neighborhood before editing, renaming, merging, or deleting: returns page content, headings, breadcrumb hierarchy, child pages and descendant count, resolved and broken outbound wikilinks, incoming backlinks, safety flags, and recent page activity.',
  inputSchema: {
    type: 'object',
    properties: {
      page: {
        type: 'string',
        description:
          'Page id, slug, title, or alias to inspect together with its links, hierarchy, and history.',
      },
      includeBody: {
        type: 'boolean',
        description: 'Include the markdown body excerpt (default true).',
      },
      maxChars: {
        type: 'integer',
        minimum: 100,
        maximum: 20000,
        description:
          'Maximum body characters to return when includeBody is true (default 6000).',
      },
      includeDrafts: {
        type: 'boolean',
        description:
          'Explicitly inspect working policy drafts and archived pages (default false).',
      },
      activityLimit: {
        type: 'integer',
        minimum: 1,
        maximum: 50,
        description:
          'Maximum number of recent activity and agent-change entries scoped to this page (default 10).',
      },
    },
    required: ['page'],
  },
  run: async (ctx, args) => {
    const store = requireLoadedStore(ctx)
    const ref = readAgentToolStringArg(args, 'page')?.trim()
    if (!ref) {
      throw new AgentKnowledgeToolError(
        'Pass "page": a page id, slug, title, or alias.',
      )
    }

    const found = pageByRef(store, ref)
    if (found && 'error' in found) {
      throw new AgentKnowledgeToolError(found.error)
    }
    if (!found) {
      throw new AgentKnowledgeToolError(
        `No page matching "${ref}". Use searchKnowledge or fn_researchTopic to locate pages.`,
      )
    }

    const includeDrafts = args.includeDrafts === true
    if (found.governance?.archived && !includeDrafts) {
      throw new AgentKnowledgeToolError(
        `"${found.title}" is archived. Pass includeDrafts: true to inspect archived pages.`,
      )
    }
    const resolved = safeEffectivePage(found, includeDrafts)
    if (resolved.error) {
      throw new AgentKnowledgeToolError(resolved.error)
    }
    const effective = resolved.page
    if (!effective) {
      throw new AgentKnowledgeToolError(
        'This is an unpublished policy draft. Pass includeDrafts: true to review it; it is not company policy.',
      )
    }

    const includeBody = args.includeBody !== false
    const maxChars = clampInt(args.maxChars, 6000, 100, 20000)
    const activityLimit = clampInt(args.activityLimit, 10, 1, 50)

    const space = store.spaces.find(s => s.id === found.spaceId) ?? null
    const isSpaceRoot = store.spaces.some(s => s.rootPageId === found.id)
    const pageIsPolicy = isPolicy(found)
    const breadcrumbs = findPagePath(store, found.id).map(p => ({
      id: p.id,
      title: p.title,
      kind: p.kind,
    }))
    const children = store.pages
      .filter(p => p.parentId === found.id)
      .sort((a, b) => a.title.localeCompare(b.title))
      .map(p => ({
        id: p.id,
        title: p.title,
        kind: p.kind,
        updatedAt: p.updatedAt,
      }))
    const descendantCount = countDescendants(store, found.id)

    const backlinks = findWikiBacklinks(store, found).map(src => ({
      id: src.id,
      title: src.title,
      kind: src.kind,
      updatedAt: src.updatedAt,
    }))
    const outboundLinks = resolveOutboundLinks(
      store,
      found.spaceId,
      effective.body,
    )
    const replacementPage = found.replacementPageId
      ? store.pages.find(p => p.id === found.replacementPageId) ?? null
      : null

    const headings = pageHeadings(effective.body)
    const truncated = effective.body.length > maxChars

    const recentActivity = store.activity
      .filter(entry => entry.pageId === found.id)
      .slice(0, activityLimit)
      .map(entry => ({
        at: entry.at,
        type: entry.type,
        text: entry.text,
        actorType: entry.actorType ?? 'human',
        actorName: entry.actorName,
      }))
    const recentAgentChanges = (store.agentChanges ?? [])
      .filter(change => change.pageId === found.id)
      .slice(0, activityLimit)
      .map(change => ({
        changeType: change.changeType,
        status: change.status,
        agentName: change.agentName,
        at: change.proposedAt,
        summary: change.summary,
      }))

    const blockingReason = pageIsPolicy
      ? 'Policy pages cannot be deleted or merged by an agent.'
      : isSpaceRoot
        ? 'Space root pages cannot be deleted or merged away.'
        : undefined

    return {
      mutated: false,
      summary: `Inspected "${effective.title}": ${backlinks.length} backlink${backlinks.length === 1 ? '' : 's'}, ${outboundLinks.length} outbound link${outboundLinks.length === 1 ? '' : 's'}, ${descendantCount} descendant${descendantCount === 1 ? '' : 's'}.`,
      data: {
        page: {
          id: found.id,
          slug: found.slug,
          status: knowledgeStatus(found),
          title: effective.title,
          kind: effective.kind,
          spaceId: found.spaceId,
          tags: effective.tags,
          aliases: found.aliases ?? [],
          links: effective.links,
          ...guidanceMetadata(found),
          updatedAt: found.updatedAt,
          isSpaceRoot,
          isPolicy: pageIsPolicy,
          bodyCharacters: effective.body.length,
          truncated: includeBody ? truncated : false,
          sections: headings.slice(0, 50),
          ...(includeBody
            ? {
                body: truncated
                  ? effective.body.slice(0, maxChars)
                  : effective.body,
              }
            : {}),
        },
        hierarchy: {
          space: space ? { id: space.id, name: space.name } : null,
          breadcrumbs,
          children,
          descendantCount,
        },
        graph: {
          outboundLinks,
          brokenOutboundCount: outboundLinks.filter(l => l.broken).length,
          backlinks,
          replacementPage: replacementPage
            ? { id: replacementPage.id, title: replacementPage.title }
            : null,
        },
        impactSummary: {
          backlinkCount: backlinks.length,
          descendantCount,
          canDeleteOrMerge: !blockingReason,
          ...(blockingReason ? { blockingReason } : {}),
        },
        recentActivity,
        recentAgentChanges,
      },
    }
  },
})

/**
 * 4. fn_captureOrUpdateNote
 * Replaces: searchKnowledge + readKnowledgePage + applyKnowledgeChange (create/update)
 */
const fn_captureOrUpdateNote = defineAppFunction<KnowledgeAgentToolContext>({
  name: 'fn_captureOrUpdateNote',
  category: 'editing',
  risk: 'write',
  requiresApproval: true,
  replaces: ['searchKnowledge', 'readKnowledgePage', 'applyKnowledgeChange'],
  description:
    'Capture new knowledge or update an existing wiki page or note in one call without creating duplicate titles: locates an existing page by reference or title to append (optionally under a markdown heading) or replace its body while preserving existing tags, or creates a new page, recording before/after in the agent log and operations ledger.',
  inputSchema: {
    type: 'object',
    properties: {
      page: {
        type: 'string',
        description:
          'Optional existing page id, slug, title, or alias to target explicitly.',
      },
      title: {
        type: 'string',
        description:
          'Page title to locate in the target space or use when creating a new page. Required unless "page" targets an existing page.',
      },
      content: {
        type: 'string',
        description:
          'Markdown content to write or append. Supports [[Page name]] wikilinks.',
      },
      mode: {
        type: 'string',
        enum: ['upsert', 'append', 'replace'],
        description:
          'How to apply content: "upsert" (default) appends to an existing matching page or creates a new one; "append" requires an existing page and appends; "replace" overwrites an existing page body or creates a new page.',
      },
      sectionHeading: {
        type: 'string',
        description:
          'Optional heading text (e.g. "Decisions") inserted as a level-2 markdown heading above the captured content when creating or appending.',
      },
      space: {
        type: 'string',
        description:
          'Optional target space id or exact name (defaults to parent space, existing page space, or active space).',
      },
      parent: {
        type: 'string',
        description:
          'Optional parent page id, slug, title, or alias to organize a newly created page under.',
      },
      kind: {
        type: 'string',
        enum: ['wiki', 'note'],
        description:
          'Page kind when creating a new page ("wiki" default for durable reference, "note" for informal capture).',
      },
      tags: {
        description:
          'Tags as a comma-separated string or array of strings; merged without removing existing tags on append/upsert.',
        anyOf: [
          { type: 'string' },
          { type: 'array', items: { type: 'string' } },
        ],
      },
      summary: {
        type: 'string',
        description:
          'One-line summary explaining why this capture or update matters (recorded in the agent log and operations ledger).',
      },
      agentName: {
        type: 'string',
        description:
          'Agent attribution recorded in the log (defaults to "Assistant").',
      },
    },
    required: ['content', 'summary'],
  },
  run: async (ctx, args) => {
    const store = requireLoadedStore(ctx)
    const content = readAgentToolStringArg(args, 'content')?.trim()
    if (!content) {
      throw new AgentKnowledgeToolError(
        'Pass "content": markdown text to capture or append.',
      )
    }
    const summary = readAgentToolStringArg(args, 'summary')?.trim()
    if (!summary) {
      throw new AgentKnowledgeToolError(
        'Pass "summary": one sentence explaining why this change is worth making.',
      )
    }

    const modeRaw = readAgentToolStringArg(args, 'mode') ?? 'upsert'
    if (modeRaw !== 'upsert' && modeRaw !== 'append' && modeRaw !== 'replace') {
      throw new AgentKnowledgeToolError(
        'mode must be "upsert", "append", or "replace".',
      )
    }
    const mode = modeRaw

    const spaceRef = readAgentToolStringArg(args, 'space')?.trim()
    const requestedSpace = spaceRef ? spaceByRef(store, spaceRef) : undefined
    if (spaceRef && !requestedSpace) {
      throw new AgentKnowledgeToolError(
        `No space matching "${spaceRef}". Available spaces: ${store.spaces.map(s => s.name).join(', ') || 'none'}.`,
      )
    }

    const parentRef = readAgentToolStringArg(args, 'parent')?.trim()
    const parent = parentRef ? pageByRef(store, parentRef) : undefined
    if (parent && 'error' in parent) {
      throw new AgentKnowledgeToolError(parent.error)
    }
    if (parentRef && !parent) {
      throw new AgentKnowledgeToolError(
        `No page matching "${parentRef}" to organize this under.`,
      )
    }
    if (requestedSpace && parent && parent.spaceId !== requestedSpace.id) {
      throw new AgentKnowledgeToolError(
        `Parent "${parent.title}" belongs to a different space than "${requestedSpace.name}".`,
      )
    }

    const kindRaw = readAgentToolStringArg(args, 'kind')
    if (kindRaw && kindRaw !== 'wiki' && kindRaw !== 'note') {
      throw new AgentKnowledgeToolError('kind must be "wiki" or "note".')
    }
    const kind = kindRaw as KnowledgePageKind | undefined

    const pageRef = readAgentToolStringArg(args, 'page')?.trim()
    const titleArg = readAgentToolStringArg(args, 'title')?.trim()

    let existing: KnowledgePage | undefined
    if (pageRef) {
      const resolved = pageByRef(store, pageRef)
      if (resolved && 'error' in resolved) {
        throw new AgentKnowledgeToolError(resolved.error)
      }
      if (!resolved) {
        throw new AgentKnowledgeToolError(
          `No page matching "${pageRef}". Pass "title" without "page" to upsert or create a new page.`,
        )
      }
      existing = resolved
    } else if (titleArg) {
      const targetSpaceId =
        requestedSpace?.id ??
        parent?.spaceId ??
        store.activeSpaceId ??
        store.spaces[0]?.id
      const lowered = titleArg.toLowerCase()
      existing = store.pages.find(
        p =>
          (!targetSpaceId || p.spaceId === targetSpaceId) &&
          !p.governance?.archived &&
          (p.title.trim().toLowerCase() === lowered ||
            (p.aliases ?? []).some(a => a.trim().toLowerCase() === lowered)),
      )
    } else {
      throw new AgentKnowledgeToolError(
        'Pass "title" (to locate or create a page) or "page" (to target an existing page).',
      )
    }

    if (mode === 'append' && !existing) {
      throw new AgentKnowledgeToolError(
        `Cannot append: no existing page matching "${titleArg ?? pageRef}". Use mode "upsert" to create if absent.`,
      )
    }

    const existingIsRoot = existing
      ? store.spaces.some(s => s.rootPageId === existing.id)
      : false
    if (existing && parent && parent.spaceId !== existing.spaceId) {
      throw new AgentKnowledgeToolError(
        `"${existing.title}" cannot be organized under a page from another space.`,
      )
    }
    if (existing && parent && wouldCreateParentCycle(store, existing.id, parent.id)) {
      throw new AgentKnowledgeToolError(
        `"${existing.title}" cannot be organized under itself or one of its own descendants.`,
      )
    }
    if (existingIsRoot && kind === 'note') {
      throw new AgentKnowledgeToolError(
        `"${existing?.title}" is a space root and must remain a wiki page.`,
      )
    }
    if (existingIsRoot && parent) {
      throw new AgentKnowledgeToolError(
        `"${existing?.title}" is a space root and must remain a top-level wiki page.`,
      )
    }

    const targetSpaceId =
      existing?.spaceId ??
      parent?.spaceId ??
      requestedSpace?.id ??
      store.activeSpaceId ??
      store.spaces[0]?.id
    if (!targetSpaceId) {
      throw new AgentKnowledgeToolError('The knowledge base has no space yet.')
    }

    const sectionHeading = readAgentToolStringArg(args, 'sectionHeading')
      ?.trim()
      .replace(/^#+\s*/, '')
    const formattedChunk = sectionHeading
      ? `## ${sectionHeading}\n\n${content}`
      : content
    const incomingTags = parseTagsArg(args.tags)
    const agentName =
      readAgentToolStringArg(args, 'agentName')?.trim() || 'Assistant'

    let appliedAction: 'created' | 'appended' | 'replaced' = existing
      ? mode === 'replace'
        ? 'replaced'
        : 'appended'
      : 'created'
    let resultPageId = existing?.id ?? ''
    let resultTitle = existing?.title ?? titleArg!
    let resultTags: string[] = []
    let resultBodyLength = 0

    await ctx.saveStore(current => {
      const currentExisting = existing
        ? current.pages.find(p => p.id === existing.id)
        : undefined
      if (existing && !currentExisting) {
        throw new AgentKnowledgeToolError(
          `"${existing.title}" was removed before this change could be applied; retry.`,
        )
      }
      const currentParent = parent
        ? current.pages.find(p => p.id === parent.id)
        : undefined
      if (parent && !currentParent) {
        throw new AgentKnowledgeToolError(
          `The parent page "${parent.title}" no longer exists; retry.`,
        )
      }

      const resolvedSpaceId = currentParent?.spaceId ?? targetSpaceId
      const liveExisting =
        currentExisting ??
        (titleArg
          ? current.pages.find(
              p =>
                p.spaceId === resolvedSpaceId &&
                !p.governance?.archived &&
                p.title.trim().toLowerCase() === titleArg.toLowerCase(),
            )
          : undefined)

      if (liveExisting) {
        const nextBody =
          mode === 'replace'
            ? formattedChunk
            : [liveExisting.body.trimEnd(), formattedChunk]
                .filter(Boolean)
                .join('\n\n')
        const nextTags =
          incomingTags !== undefined
            ? mode === 'replace'
              ? incomingTags
              : mergeTags(liveExisting.tags, incomingTags)
            : undefined

        appliedAction = mode === 'replace' ? 'replaced' : 'appended'
        resultPageId = liveExisting.id
        resultTitle = liveExisting.title
        resultTags = nextTags ?? liveExisting.tags
        resultBodyLength = nextBody.length

        return applyKnowledgeAgentChange(current, {
          spaceId: liveExisting.spaceId,
          pageId: liveExisting.id,
          agentName,
          changeType: 'page.update',
          title: liveExisting.title,
          summary,
          before: liveExisting.body,
          after: nextBody,
          patch: {
            body: nextBody,
            ...(nextTags !== undefined ? { tags: nextTags } : {}),
            ...(currentParent ? { parentId: currentParent.id } : {}),
            ...(kind ? { kind } : {}),
          },
        })
      }

      const newTitle = titleArg!
      appliedAction = 'created'
      resultTitle = newTitle
      resultTags = incomingTags ?? []
      resultBodyLength = formattedChunk.length

      const next = applyKnowledgeAgentChange(current, {
        spaceId: resolvedSpaceId,
        agentName,
        changeType: 'page.create',
        title: newTitle,
        summary,
        before: '',
        after: formattedChunk,
        patch: {
          title: newTitle,
          body: formattedChunk,
          ...(incomingTags !== undefined ? { tags: incomingTags } : {}),
          ...(currentParent ? { parentId: currentParent.id } : {}),
          kind: kind ?? 'wiki',
        },
      })
      resultPageId = next.activePageId ?? ''
      return next
    })

    const ledgerKind =
      appliedAction === 'created'
        ? 'knowledge.page.create'
        : 'knowledge.page.update'
    void recordOperation({
      lane: 'agent',
      kind: ledgerKind,
      appSlug: KNOWLEDGE_APP_SLUG,
      summary: `${agentName}: ${summary}`,
      detail: `${appliedAction} "${resultTitle}"`,
    }).catch(() => undefined)

    return {
      mutated: true,
      summary: `${appliedAction === 'created' ? 'Created' : appliedAction === 'appended' ? 'Appended to' : 'Updated'} "${resultTitle}": ${summary}`,
      data: {
        action: appliedAction,
        pageId: resultPageId,
        title: resultTitle,
        spaceId: targetSpaceId,
        tags: resultTags,
        bodyCharacters: resultBodyLength,
        storePath: ctx.storePath,
      },
    }
  },
})

export const PUREKNOWLEDGE_FUNCTIONS: readonly AppFunctionDefinition<KnowledgeAgentToolContext>[] =
  [
    fn_researchTopic,
    fn_knowledgeHealthAudit,
    fn_inspectPageNeighborhood,
    fn_captureOrUpdateNote,
  ]
