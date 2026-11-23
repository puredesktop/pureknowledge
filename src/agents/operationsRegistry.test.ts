import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../bridge/platformBridge', () => ({
  recordOperation: vi.fn(async () => undefined),
}))
vi.mock('../bridge/knowledgeAssets', () => ({
  importKnowledgeImages: vi.fn(async () => []),
}))

import manifest from '../../plugin.json'
import { recordOperation } from '../bridge/platformBridge'
import { createOrganisationKnowledge } from '../lib/createOrganisationKnowledge'
import {
  applyKnowledgeAgentChange,
  createDefaultKnowledgeStore,
  createKnowledgePage,
  createKnowledgeSpace,
  updateKnowledgePage,
} from '../lib/knowledgeStore'
import type { KnowledgeStore } from '../lib/knowledgeTypes'
import { PUREKNOWLEDGE_ATOMIC_TOOL_SCHEMAS } from './atomicToolSchemas'
import {
  AgentKnowledgeToolError,
  EXPOSED_TOOL_NAMES,
  PRIVATE_ORGANISATION_ACCESS_ERROR,
  PUREKNOWLEDGE_AGENT_TOOL_NAMES,
  PUREKNOWLEDGE_ALL_ATOMIC_TOOL_NAMES,
  PUREKNOWLEDGE_CORE_TOOL_NAMES,
  PUREKNOWLEDGE_EXTENDED_TOOL_NAMES,
  PUREKNOWLEDGE_FUNCTION_NAMES,
  PUREKNOWLEDGE_META_TOOL_NAMES,
  type KnowledgeAgentToolContext,
} from './catalog'
import { PUREKNOWLEDGE_ATOMIC_RUNNERS } from './handlers'
import {
  PUREKNOWLEDGE_OPERATIONS_REGISTRY,
  buildPureKnowledgeHandlers,
} from './operationsRegistry'

const invoke = (shortName: string, args: Record<string, unknown> = {}) => ({
  toolCallId: `tc_${shortName}`,
  shortName,
  arguments: args,
})

const RELEASE_VERBS = new Set([
  'send',
  'sends',
  'sending',
  'merge',
  'merges',
  'merging',
  'publish',
  'publishes',
  'publishing',
  'deposit',
  'deposits',
  'depositing',
  'deploy',
  'deploys',
  'deploying',
  'post',
  'posts',
  'posting',
])

function makeRichStore() {
  let store = createDefaultKnowledgeStore()
  const mainSpaceId = store.activeSpaceId
  const rootPageId = store.spaces[0]!.rootPageId!

  store = createKnowledgePage(store, {
    spaceId: mainSpaceId,
    parentId: rootPageId,
    kind: 'wiki',
    title: 'Render Pipeline',
    body: '# Overview\n\nThe render pipeline compiles scenes using [[Shader Guide]] and [[Missing Spec]].\n\n## Caching\n\nFrames are cached per viewport.',
    tags: ['graphics', 'architecture'],
  })
  const renderPageId = store.activePageId!
  store = updateKnowledgePage(store, renderPageId, {
    guidanceStatus: 'current',
    lastChecked: {
      actorType: 'human',
      actorName: 'You',
      at: '2026-10-01T00:00:00.000Z',
    },
  })

  store = createKnowledgePage(store, {
    spaceId: mainSpaceId,
    parentId: renderPageId,
    kind: 'wiki',
    title: 'Shader Guide',
    body: '# Shaders\n\nReferenced by [[Render Pipeline]].',
    tags: ['graphics'],
  })
  const shaderPageId = store.activePageId!

  store = createKnowledgePage(store, {
    spaceId: mainSpaceId,
    parentId: shaderPageId,
    kind: 'note',
    title: 'Shader Benchmarks',
    body: 'Frame times on M3 Max.',
    tags: ['perf'],
  })
  const benchPageId = store.activePageId!

  store = createKnowledgePage(store, {
    spaceId: mainSpaceId,
    kind: 'wiki',
    title: 'Orphan Legacy Guide',
    body: 'Old guide nobody links to.',
    tags: ['legacy'],
  })
  const orphanPageId = store.activePageId!
  // Force stale updatedAt > 120 days ago and mark retired without replacement
  store = {
    ...store,
    pages: store.pages.map(p =>
      p.id === orphanPageId
        ? {
            ...p,
            updatedAt: '2025-01-15T00:00:00.000Z',
          }
        : p,
    ),
  }

  store = createKnowledgePage(store, {
    spaceId: mainSpaceId,
    kind: 'wiki',
    title: 'Retired Runbook',
    body: 'Replaced procedure.',
    tags: ['ops'],
  })
  const retiredPageId = store.activePageId!
  store = updateKnowledgePage(store, retiredPageId, {
    guidanceStatus: 'retired',
  })

  store = createKnowledgePage(store, {
    spaceId: mainSpaceId,
    kind: 'wiki',
    title: 'Unchecked Standard',
    body: 'Standard marked current without check.',
    tags: ['kept-copy'],
  })
  const uncheckedCurrentId = store.activePageId!
  store = updateKnowledgePage(store, uncheckedCurrentId, {
    guidanceStatus: 'current',
  })

  // Record an agent change on Render Pipeline
  store = applyKnowledgeAgentChange(store, {
    spaceId: mainSpaceId,
    pageId: renderPageId,
    agentName: 'Curator',
    changeType: 'page.update',
    title: 'Render Pipeline',
    summary: 'Documented caching stage',
    before: 'old',
    after: store.pages.find(p => p.id === renderPageId)!.body,
    patch: { body: store.pages.find(p => p.id === renderPageId)!.body },
  })

  // Create a second space
  store = createKnowledgeSpace(store, {
    name: 'Operations',
    description: 'Runbooks and operational guides',
  })
  const opsSpaceId = store.activeSpaceId
  store = createKnowledgePage(store, {
    spaceId: opsSpaceId,
    kind: 'wiki',
    title: 'Incident Checklist',
    body: 'Follow steps 1-3 for render outages.',
    tags: ['ops'],
  })
  const opsPageId = store.activePageId!

  // Switch active space back to main
  store = { ...store, activeSpaceId: mainSpaceId, activePageId: renderPageId }

  return {
    store,
    ids: {
      mainSpaceId,
      opsSpaceId,
      rootPageId,
      renderPageId,
      shaderPageId,
      benchPageId,
      orphanPageId,
      retiredPageId,
      uncheckedCurrentId,
      opsPageId,
    },
  }
}

function makeContext(initialStore: KnowledgeStore | null) {
  let current = initialStore
  const saveStore = vi.fn(
    async (
      update: KnowledgeStore | ((store: KnowledgeStore) => KnowledgeStore),
    ) => {
      current = typeof update === 'function' ? update(current!) : update
    },
  )
  const ctx: KnowledgeAgentToolContext = {
    get store() {
      return current
    },
    saveStore,
    storePath: '/Users/dev/PureScience/knowledge.knowledge',
  }
  return { ctx, getStore: () => current, saveStore }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('PureKnowledge Operations Registry & manifest sync', () => {
  it('enforces exact 3-tier operation counts and catalog exports', () => {
    const summary = PUREKNOWLEDGE_OPERATIONS_REGISTRY.auditSummary()
    expect(summary).toMatchObject({
      appSlug: 'knowledge',
      functions: 4,
      coreTools: 4,
      extendedTools: 5,
      metaTools: 3,
      totalExposed: 11,
      totalAtomicTools: 9,
      totalRegistered: 13,
    })

    expect(PUREKNOWLEDGE_OPERATIONS_REGISTRY.functions.map(f => f.name)).toEqual([
      ...PUREKNOWLEDGE_FUNCTION_NAMES,
    ])
    expect(PUREKNOWLEDGE_OPERATIONS_REGISTRY.coreTools.map(t => t.name)).toEqual([
      ...PUREKNOWLEDGE_CORE_TOOL_NAMES,
    ])
    expect(PUREKNOWLEDGE_OPERATIONS_REGISTRY.extendedToolNames).toEqual([
      ...PUREKNOWLEDGE_EXTENDED_TOOL_NAMES,
    ])
    expect(PUREKNOWLEDGE_OPERATIONS_REGISTRY.exposedToolNames).toEqual([
      ...EXPOSED_TOOL_NAMES,
    ])
    expect(PUREKNOWLEDGE_AGENT_TOOL_NAMES).toEqual(EXPOSED_TOOL_NAMES)
    expect([...PUREKNOWLEDGE_OPERATIONS_REGISTRY.allAtomicToolNames].sort()).toEqual(
      [...PUREKNOWLEDGE_ALL_ATOMIC_TOOL_NAMES].sort(),
    )
    expect(PUREKNOWLEDGE_META_TOOL_NAMES).toEqual([
      'discoverAppTools',
      'callExtendedReadTool',
      'callExtendedTool',
    ])
  })

  it('pairs every atomic schema entry with a live runner', () => {
    const schemaNames = PUREKNOWLEDGE_ATOMIC_TOOL_SCHEMAS.map(s => s.name).sort()
    const runnerNames = Object.keys(PUREKNOWLEDGE_ATOMIC_RUNNERS).sort()
    expect(schemaNames).toEqual(runnerNames)
  })

  it('matches plugin.json app.agents.tools 1:1 with registry.manifestTools', () => {
    expect(manifest.app.agents.tools).toEqual(
      PUREKNOWLEDGE_OPERATIONS_REGISTRY.manifestTools,
    )
  })

  it('satisfies check-manifests rules on every exposed tool and function', () => {
    for (const entry of PUREKNOWLEDGE_OPERATIONS_REGISTRY.manifestTools) {
      expect(entry.description.trim().length).toBeGreaterThanOrEqual(80)
      expect(typeof entry.requiresApproval).toBe('boolean')
      const nameFirstWord = entry.name
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .split(/[^A-Za-z]+/)
        .find(Boolean)
        ?.toLowerCase()
      const descFirstWord = entry.description
        .trim()
        .split(/[^A-Za-z]+/)
        .find(Boolean)
        ?.toLowerCase()
      if (entry.risk !== 'release') {
        expect(RELEASE_VERBS.has(nameFirstWord ?? '')).toBe(false)
        expect(RELEASE_VERBS.has(descFirstWord ?? '')).toBe(false)
      }
    }
  })
})

describe('Extended escape-hatch discovery, routing, and refusals', () => {
  it('discovers extended specialist tools by query, category, exact names, and includeFunctions', async () => {
    const { store } = makeRichStore()
    const { ctx } = makeContext(store)
    const handlers = buildPureKnowledgeHandlers(() => ctx)

    const allRes = JSON.parse(
      (await handlers.discoverAppTools!(invoke('discoverAppTools', {}))).content,
    )
    expect(allRes.appSlug).toBe('knowledge')
    expect(allRes.totalMatched).toBe(5)
    expect(allRes.categories).toEqual(['audit', 'curation', 'links', 'spaces'])

    const auditRes = JSON.parse(
      (
        await handlers.discoverAppTools!(
          invoke('discoverAppTools', { category: 'audit' }),
        )
      ).content,
    )
    expect(auditRes.operations.map((o: { name: string }) => o.name)).toEqual([
      'listKnowledgeActivity',
      'listKnowledgeChanges',
    ])
    expect(auditRes.operations[0].invokeVia).toBe('callExtendedReadTool')

    const backlinkSearch = JSON.parse(
      (
        await handlers.discoverAppTools!(
          invoke('discoverAppTools', { query: 'backlinks' }),
        )
      ).content,
    )
    expect(backlinkSearch.operations[0].name).toBe('getBacklinks')

    const described = JSON.parse(
      (
        await handlers.discoverAppTools!(
          invoke('discoverAppTools', {
            names: ['reviewKnowledge', 'fn_researchTopic', 'unknownTool'],
          }),
        )
      ).content,
    )
    expect(described.operations).toEqual([
      expect.objectContaining({
        name: 'reviewKnowledge',
        found: true,
        exposure: 'extended',
        invokeVia: 'callExtendedReadTool',
      }),
      expect.objectContaining({
        name: 'fn_researchTopic',
        found: true,
        opClass: 'function',
        exposure: 'always',
        invokeVia: 'direct',
      }),
      expect.objectContaining({
        name: 'unknownTool',
        found: false,
      }),
    ])

    const withFunctions = JSON.parse(
      (
        await handlers.discoverAppTools!(
          invoke('discoverAppTools', { includeFunctions: true }),
        )
      ).content,
    )
    expect(withFunctions.totalMatched).toBe(13)
  })

  it('routes all 5 extended read tools through callExtendedReadTool cleanly', async () => {
    const { store, ids } = makeRichStore()
    const { ctx } = makeContext(store)
    const handlers = buildPureKnowledgeHandlers(() => ctx)

    const spaces = JSON.parse(
      (
        await handlers.callExtendedReadTool!(
          invoke('callExtendedReadTool', { tool: 'listSpaces', arguments: {} }),
        )
      ).content,
    )
    expect(spaces.spaces).toHaveLength(2)

    const backlinks = JSON.parse(
      (
        await handlers.callExtendedReadTool!(
          invoke('callExtendedReadTool', {
            tool: 'getBacklinks',
            arguments: { page: ids.shaderPageId },
          }),
        )
      ).content,
    )
    expect(backlinks.backlinks).toEqual([
      expect.objectContaining({ id: ids.renderPageId, title: 'Render Pipeline' }),
    ])

    const activity = JSON.parse(
      (
        await handlers.callExtendedReadTool!(
          invoke('callExtendedReadTool', {
            tool: 'listKnowledgeActivity',
            arguments: { limit: 5 },
          }),
        )
      ).content,
    )
    expect(activity.entries.length).toBeGreaterThan(0)

    const review = JSON.parse(
      (
        await handlers.callExtendedReadTool!(
          invoke('callExtendedReadTool', {
            tool: 'reviewKnowledge',
            arguments: { space: ids.mainSpaceId },
          }),
        )
      ).content,
    )
    expect(
      review.findings.some(
        (f: { kind: string; pageId: string }) =>
          f.kind === 'brokenLink' && f.pageId === ids.renderPageId,
      ),
    ).toBe(true)

    const changes = JSON.parse(
      (
        await handlers.callExtendedReadTool!(
          invoke('callExtendedReadTool', {
            tool: 'listKnowledgeChanges',
            arguments: { limit: 5 },
          }),
        )
      ).content,
    )
    expect(changes.changes[0]).toMatchObject({
      title: 'Render Pipeline',
      agentName: 'Curator',
    })
  })

  it('enforces strict escape-hatch refusals for direct, read-only, invalid, and unknown calls', async () => {
    const { store } = makeRichStore()
    const { ctx } = makeContext(store)
    const handlers = buildPureKnowledgeHandlers(() => ctx)

    await expect(
      handlers.callExtendedReadTool!(
        invoke('callExtendedReadTool', { tool: 'getKnowledgeContext' }),
      ),
    ).rejects.toThrow(/directly exposed/)

    await expect(
      handlers.callExtendedReadTool!(
        invoke('callExtendedReadTool', { tool: 'fn_researchTopic' }),
      ),
    ).rejects.toThrow(/directly exposed/)

    await expect(
      handlers.callExtendedReadTool!(
        invoke('callExtendedReadTool', { tool: 'doesNotExist' }),
      ),
    ).rejects.toThrow(/Unknown extended tool/)

    await expect(
      handlers.callExtendedReadTool!(
        invoke('callExtendedReadTool', {
          tool: 'listSpaces',
          arguments: 'not-an-object',
        }),
      ),
    ).rejects.toThrow(/"arguments" must be a JSON object/)

    await expect(
      handlers.callExtendedTool!(
        invoke('callExtendedTool', { tool: 'listSpaces' }),
      ),
    ).rejects.toThrow(/read-only/i)

    await expect(
      handlers.callExtendedTool!(
        invoke('callExtendedTool', { tool: 'applyKnowledgeChange' }),
      ),
    ).rejects.toThrow(/directly exposed/)

    await expect(
      handlers.callExtendedTool!(
        invoke('callExtendedTool', { tool: '' }),
      ),
    ).rejects.toThrow(/"tool" is required/)
  })

  it('refuses every exposed handler on private organisation-bound stores', async () => {
    const orgStore = createOrganisationKnowledge('org-secret', 'Secret Corp')
    const { ctx, saveStore } = makeContext(orgStore)
    const handlers = buildPureKnowledgeHandlers(() => ctx)

    for (const name of EXPOSED_TOOL_NAMES) {
      await expect(
        handlers[name]!(invoke(name, { query: 'Secret', page: 'any', tool: 'listSpaces' })),
      ).rejects.toThrow(PRIVATE_ORGANISATION_ACCESS_ERROR)
    }
    expect(saveStore).not.toHaveBeenCalled()
  })
})

describe('Composite App Functions (fn_*)', () => {
  it('fn_researchTopic searches, hydrates top pages with graph/headings/changes, and respects draft isolation', async () => {
    const { store: baseStore, ids } = makeRichStore()
    // Add an unpublished policy draft that must stay hidden unless includeDrafts: true
    let store = createKnowledgePage(baseStore, {
      spaceId: ids.mainSpaceId,
      kind: 'wiki',
      title: 'Render Secret Policy Draft',
      body: 'Unpublished render policy text.',
    })
    const draftId = store.activePageId!
    store = {
      ...store,
      pages: store.pages.map(p =>
        p.id === draftId
          ? {
              ...p,
              governance: { category: 'policy' as const },
            }
          : p,
      ),
    }

    const { ctx } = makeContext(store)
    const handlers = buildPureKnowledgeHandlers(() => ctx)

    const envelope = JSON.parse(
      (
        await handlers.fn_researchTopic!(
          invoke('fn_researchTopic', {
            query: 'render',
            maxPages: 2,
            maxCharsPerPage: 200,
          }),
        )
      ).content,
    )
    expect(envelope.ok).toBe(true)
    expect(envelope.opClass).toBe('function')
    expect(envelope.function).toBe('fn_researchTopic')
    expect(envelope.data.searchedBy).toBe('words')
    expect(envelope.data.hydratedCount).toBeLessThanOrEqual(2)

    const renderHit = envelope.data.pages.find(
      (p: { id: string }) => p.id === ids.renderPageId,
    )
    expect(renderHit).toBeDefined()
    expect(renderHit.guidanceStatus).toBe('current')
    expect(renderHit.sections.map((s: { heading: string }) => s.heading)).toEqual([
      'Overview',
      'Caching',
    ])
    expect(renderHit.outboundLinks).toEqual([
      expect.objectContaining({
        target: 'Shader Guide',
        resolvedPageId: ids.shaderPageId,
        broken: false,
      }),
      expect.objectContaining({
        target: 'Missing Spec',
        resolvedPageId: null,
        broken: true,
      }),
    ])
    expect(renderHit.backlinks).toEqual([
      expect.objectContaining({ id: ids.shaderPageId, title: 'Shader Guide' }),
    ])
    expect(envelope.data.relatedRecentChanges).toEqual([
      expect.objectContaining({
        pageId: ids.renderPageId,
        agentName: 'Curator',
        summary: 'Documented caching stage',
      }),
    ])
    // Policy draft is hidden when includeDrafts is false
    expect(
      [...envelope.data.pages, ...envelope.data.additionalMatches].some(
        (p: { id: string }) => p.id === draftId,
      ),
    ).toBe(false)

    // Policy draft appears when includeDrafts: true
    const withDrafts = JSON.parse(
      (
        await handlers.fn_researchTopic!(
          invoke('fn_researchTopic', {
            query: 'Render Secret Policy Draft',
            includeDrafts: true,
          }),
        )
      ).content,
    )
    expect(
      withDrafts.data.pages.some((p: { id: string }) => p.id === draftId),
    ).toBe(true)

    await expect(
      handlers.fn_researchTopic!(invoke('fn_researchTopic', { query: '   ' })),
    ).rejects.toBeInstanceOf(AgentKnowledgeToolError)
  })

  it('fn_knowledgeHealthAudit aggregates multi-space findings, guidance attention, kept copies, and activity', async () => {
    const { store, ids } = makeRichStore()
    const { ctx } = makeContext(store)
    const handlers = buildPureKnowledgeHandlers(() => ctx)

    const fullAudit = JSON.parse(
      (
        await handlers.fn_knowledgeHealthAudit!(
          invoke('fn_knowledgeHealthAudit', {}),
        )
      ).content,
    )
    expect(fullAudit.ok).toBe(true)
    expect(fullAudit.data.totals.spaces).toBe(2)
    expect(fullAudit.data.totals.keptCopies).toBe(1)
    expect(fullAudit.data.totals.guidanceBreakdown.current).toBe(2)
    expect(fullAudit.data.totals.guidanceBreakdown.retired).toBe(1)
    expect(fullAudit.data.findings.brokenLinks).toEqual([
      expect.objectContaining({
        spaceId: ids.mainSpaceId,
        pageId: ids.renderPageId,
      }),
    ])
    expect(
      fullAudit.data.findings.orphans.some(
        (o: { pageId: string }) => o.pageId === ids.orphanPageId,
      ),
    ).toBe(true)
    expect(
      fullAudit.data.findings.stalePages.some(
        (s: { pageId: string }) => s.pageId === ids.orphanPageId,
      ),
    ).toBe(true)
    expect(fullAudit.data.guidanceAttention.retiredWithoutReplacement).toEqual([
      expect.objectContaining({ id: ids.retiredPageId }),
    ])
    expect(fullAudit.data.guidanceAttention.uncheckedCurrentPages).toEqual([
      expect.objectContaining({ id: ids.uncheckedCurrentId }),
    ])
    expect(fullAudit.data.recentActivity.length).toBeGreaterThan(0)
    expect(fullAudit.data.recentAgentChanges[0]).toMatchObject({
      title: 'Render Pipeline',
      agentName: 'Curator',
    })

    // Scope to single space ("Operations")
    const opsAudit = JSON.parse(
      (
        await handlers.fn_knowledgeHealthAudit!(
          invoke('fn_knowledgeHealthAudit', {
            space: 'Operations',
            includeActivity: false,
          }),
        )
      ).content,
    )
    expect(opsAudit.data.totals.spaces).toBe(1)
    expect(opsAudit.data.spaceSummaries[0].name).toBe('Operations')
    expect(opsAudit.data.recentActivity).toEqual([])
    expect(opsAudit.data.recentAgentChanges).toEqual([])

    await expect(
      handlers.fn_knowledgeHealthAudit!(
        invoke('fn_knowledgeHealthAudit', { space: 'Nonexistent Space' }),
      ),
    ).rejects.toThrow(/No space matching/)
  })

  it('fn_inspectPageNeighborhood returns breadcrumbs, descendants, link graph, safety flags, and history', async () => {
    const { store, ids } = makeRichStore()
    const { ctx } = makeContext(store)
    const handlers = buildPureKnowledgeHandlers(() => ctx)

    const inspected = JSON.parse(
      (
        await handlers.fn_inspectPageNeighborhood!(
          invoke('fn_inspectPageNeighborhood', { page: 'Render Pipeline' }),
        )
      ).content,
    )
    expect(inspected.ok).toBe(true)
    expect(inspected.data.page.id).toBe(ids.renderPageId)
    expect(inspected.data.hierarchy.breadcrumbs.map((b: { id: string }) => b.id)).toEqual([
      ids.rootPageId,
      ids.renderPageId,
    ])
    expect(inspected.data.hierarchy.children).toEqual([
      expect.objectContaining({ id: ids.shaderPageId, title: 'Shader Guide' }),
    ])
    // Shader Guide + Shader Benchmarks = 2 descendants
    expect(inspected.data.hierarchy.descendantCount).toBe(2)
    expect(inspected.data.graph.brokenOutboundCount).toBe(1)
    expect(inspected.data.graph.backlinks).toEqual([
      expect.objectContaining({ id: ids.shaderPageId }),
    ])
    expect(inspected.data.impactSummary).toMatchObject({
      backlinkCount: 1,
      descendantCount: 2,
      canDeleteOrMerge: true,
    })
    expect(inspected.data.recentAgentChanges).toEqual([
      expect.objectContaining({ agentName: 'Curator' }),
    ])

    // Space root flags canDeleteOrMerge: false
    const rootInspected = JSON.parse(
      (
        await handlers.fn_inspectPageNeighborhood!(
          invoke('fn_inspectPageNeighborhood', {
            page: ids.rootPageId,
            includeBody: false,
          }),
        )
      ).content,
    )
    expect(rootInspected.data.page.body).toBeUndefined()
    expect(rootInspected.data.impactSummary.canDeleteOrMerge).toBe(false)
    expect(rootInspected.data.impactSummary.blockingReason).toMatch(/Space root/)
  })

  it('fn_captureOrUpdateNote creates, appends with merged tags and heading, replaces, and validates constraints', async () => {
    const { store, ids } = makeRichStore()
    const { ctx, getStore, saveStore } = makeContext(store)
    const handlers = buildPureKnowledgeHandlers(() => ctx)

    // 1. Upsert creates a new page when absent
    const created = JSON.parse(
      (
        await handlers.fn_captureOrUpdateNote!(
          invoke('fn_captureOrUpdateNote', {
            title: 'Release Checklist',
            content: '- Verify manifest sync\n- Run vitest',
            sectionHeading: 'Pre-flight',
            parent: ids.rootPageId,
            kind: 'wiki',
            tags: ['release', 'ops'],
            summary: 'Capture release checklist',
            agentName: 'ReleaseBot',
          }),
        )
      ).content,
    )
    expect(created.ok).toBe(true)
    expect(created.data.action).toBe('created')
    expect(created.data.title).toBe('Release Checklist')
    expect(created.data.tags).toEqual(['release', 'ops'])
    expect(saveStore).toHaveBeenCalledTimes(1)
    expect(recordOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'knowledge.page.create',
        summary: 'ReleaseBot: Capture release checklist',
      }),
    )

    // 2. Upsert on the same title appends instead of creating a duplicate, and merges tags case-insensitively
    const appended = JSON.parse(
      (
        await handlers.fn_captureOrUpdateNote!(
          invoke('fn_captureOrUpdateNote', {
            title: 'Release Checklist',
            content: '- Tag build artifact',
            sectionHeading: 'Post-flight',
            tags: 'OPS, verification',
            summary: 'Add post-flight verification step',
          }),
        )
      ).content,
    )
    expect(appended.data.action).toBe('appended')
    expect(appended.data.pageId).toBe(created.data.pageId)
    expect(appended.data.tags).toEqual(['release', 'ops', 'verification'])
    const updatedPage = getStore()!.pages.find(
      p => p.id === created.data.pageId,
    )!
    expect(updatedPage.body).toContain('## Pre-flight')
    expect(updatedPage.body).toContain('## Post-flight')
    expect(updatedPage.body).toContain('- Tag build artifact')
    expect(
      getStore()!.pages.filter(p => p.title === 'Release Checklist'),
    ).toHaveLength(1)

    // 3. Preserves lastChecked on Render Pipeline when appending
    const beforeCheck = getStore()!.pages.find(
      p => p.id === ids.renderPageId,
    )!.lastChecked
    await handlers.fn_captureOrUpdateNote!(
      invoke('fn_captureOrUpdateNote', {
        page: ids.renderPageId,
        mode: 'append',
        content: 'Added telemetry note.',
        summary: 'Append telemetry note',
      }),
    )
    expect(
      getStore()!.pages.find(p => p.id === ids.renderPageId)!.lastChecked,
    ).toEqual(beforeCheck)

    // 4. Replace mode overwrites body and tags
    const replaced = JSON.parse(
      (
        await handlers.fn_captureOrUpdateNote!(
          invoke('fn_captureOrUpdateNote', {
            page: created.data.pageId,
            mode: 'replace',
            content: 'Clean slate checklist.',
            tags: ['fresh'],
            summary: 'Rewrite release checklist cleanly',
          }),
        )
      ).content,
    )
    expect(replaced.data.action).toBe('replaced')
    const replacedPage = getStore()!.pages.find(
      p => p.id === created.data.pageId,
    )!
    expect(replacedPage.body).toBe('Clean slate checklist.')
    expect(replacedPage.tags).toEqual(['fresh'])

    // 5. Validation errors
    await expect(
      handlers.fn_captureOrUpdateNote!(
        invoke('fn_captureOrUpdateNote', {
          title: 'Missing Page',
          mode: 'append',
          content: 'Should fail',
          summary: 'Attempt append to missing page',
        }),
      ),
    ).rejects.toThrow(/Cannot append/)

    await expect(
      handlers.fn_captureOrUpdateNote!(
        invoke('fn_captureOrUpdateNote', {
          page: ids.rootPageId,
          kind: 'note',
          content: 'Should fail',
          summary: 'Attempt demoting space root',
        }),
      ),
    ).rejects.toThrow(/space root/)
  })
})
