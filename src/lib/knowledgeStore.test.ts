import { describe, expect, it } from 'vitest'
import {
  addKnowledgeLink,
  acceptKnowledgeAgentChange,
  applyKnowledgeAgentChange,
  createDirectoryIndexBody,
  createDefaultKnowledgeStore,
  createKnowledgePage,
  createKnowledgeSpace,
  deleteKnowledgePage,
  rankKnowledgePages,
  extractWikiLinks,
  findPageByWikiTitle,
  findPagePath,
  findWikiBacklinks,
  getChildWikiPages,
  isKnowledgeDirectoryPage,
  KNOWLEDGE_STALE_AFTER_DAYS,
  migrateKnowledgeStore,
  normalizeKnowledgeLink,
  proposeKnowledgeAgentChange,
  rejectKnowledgeAgentChange,
  reviewKnowledgeStore,
  slugifyPageTitle,
  updateKnowledgePage,
} from './knowledgeStore'

describe('knowledge store', () => {
  it('creates a default wiki store', () => {
    const store = createDefaultKnowledgeStore()
    expect(store.schemaVersion).toBe(1)
    expect(store.spaces).toHaveLength(1)
    expect(store.pages[0].kind).toBe('wiki')
    expect(store.spaces[0].rootPageId).toBe(store.pages[0].id)
    expect(store.pages[0].title).toBe('_index')
  })

  it('migrates invalid input to a default store', () => {
    const store = migrateKnowledgeStore({ schemaVersion: 99 } as never)
    expect(store.schemaVersion).toBe(1)
    expect(store.pages.length).toBeGreaterThan(0)
  })

  it('creates spaces and selects them', () => {
    const initial = createDefaultKnowledgeStore()
    const next = createKnowledgeSpace(initial, { name: 'Project Alpha' })
    expect(next.spaces).toHaveLength(2)
    expect(next.spaces.at(-1)?.name).toBe('Project Alpha')
    expect(next.activeSpaceId).toBe(next.spaces.at(-1)?.id)
    expect(next.activePageId).toBe(next.spaces.at(-1)?.rootPageId)
  })

  it('creates child wiki pages and page paths', () => {
    const initial = createDefaultKnowledgeStore()
    const rootPageId = initial.spaces[0].rootPageId
    const next = createKnowledgePage(initial, {
      spaceId: initial.activeSpaceId,
      parentId: rootPageId,
      kind: 'wiki',
      title: 'Publishing Workflow',
    })
    const child = next.pages[0]
    expect(child.parentId).toBe(rootPageId)
    expect(child.slug).toBe('publishing-workflow')
    expect(findPagePath(next, child.id).map(page => page.title)).toEqual([
      '_index',
      'Publishing Workflow',
    ])
    expect(
      getChildWikiPages(next, rootPageId ?? '').map(page => page.title),
    ).toEqual(['Publishing Workflow'])
  })

  it('creates directory pages as index-backed wiki nodes', () => {
    const initial = createDefaultKnowledgeStore()
    const next = createKnowledgePage(initial, {
      spaceId: initial.activeSpaceId,
      parentId: initial.spaces[0].rootPageId,
      kind: 'wiki',
      title: 'Projects',
      body: createDirectoryIndexBody('Projects'),
      tags: ['directory'],
    })
    const directory = next.pages[0]
    expect(isKnowledgeDirectoryPage(directory)).toBe(true)
    expect(directory.body).toContain('Index for Projects')
  })

  it('migrates empty directory pages to directory index content', () => {
    const initial = createDefaultKnowledgeStore()
    const withDirectory = createKnowledgePage(initial, {
      spaceId: initial.activeSpaceId,
      parentId: initial.spaces[0].rootPageId,
      kind: 'wiki',
      title: 'Agents',
      tags: ['directory'],
    })
    const emptyDirectory = { ...withDirectory.pages[0], body: '' }
    const migrated = migrateKnowledgeStore({
      ...withDirectory,
      pages: [emptyDirectory, ...withDirectory.pages.slice(1)],
    })
    expect(
      migrated.pages.find(page => page.id === emptyDirectory.id)?.body,
    ).toContain('Index for Agents')
  })

  it('creates notes and promotes them to wiki pages', () => {
    const initial = createDefaultKnowledgeStore()
    const noteStore = createKnowledgePage(initial, {
      spaceId: initial.activeSpaceId,
      kind: 'note',
      title: 'Capture decision',
    })
    const note = noteStore.pages[0]
    const promoted = updateKnowledgePage(noteStore, note.id, { kind: 'wiki' })
    expect(promoted.pages[0].kind).toBe('wiki')
    expect(promoted.pages[0].promotedAt).toBeTruthy()
  })

  it('records update activity provenance', () => {
    const initial = createDefaultKnowledgeStore()
    const page = initial.pages[0]
    const updated = updateKnowledgePage(
      initial,
      page.id,
      { body: 'Edited by an agent' },
      { actor: { type: 'agent', name: 'Knowledge steward' } },
    )
    expect(updated.activity[0]).toMatchObject({
      type: 'page.updated',
      actorType: 'agent',
      actorName: 'Knowledge steward',
      pageId: page.id,
    })
  })

  it('queues agent changes before applying them', () => {
    const initial = createDefaultKnowledgeStore()
    const page = initial.pages[0]
    const proposed = proposeKnowledgeAgentChange(initial, {
      spaceId: initial.activeSpaceId,
      pageId: page.id,
      agentName: 'Knowledge steward',
      sourceAppSlug: 'review',
      severity: 'critical',
      changeType: 'page.update',
      title: 'Clarify root index',
      summary: 'Adds a short note about root-level wiki structure.',
      before: page.body,
      after: 'New index copy',
      patch: { body: 'New index copy' },
    })

    expect(
      proposed.pages.find(candidate => candidate.id === page.id)?.body,
    ).toBe(page.body)
    expect(proposed.agentChanges?.[0]).toMatchObject({
      agentName: 'Knowledge steward',
      status: 'pending',
      severity: 'critical',
    })

    const accepted = acceptKnowledgeAgentChange(
      proposed,
      proposed.agentChanges?.[0]?.id ?? '',
    )
    expect(
      accepted.pages.find(candidate => candidate.id === page.id)?.body,
    ).toBe('New index copy')
    expect(accepted.agentChanges?.[0]).toMatchObject({
      status: 'accepted',
    })
    expect(accepted.activity[0]).toMatchObject({
      type: 'agentChange.accepted',
      actorType: 'human',
    })
  })

  it('applies rename, promote, delete, and merge proposals on accept', () => {
    let store = createDefaultKnowledgeStore()
    store = createKnowledgePage(store, {
      spaceId: store.activeSpaceId,
      kind: 'note',
      title: 'Render pipeline notes',
      body: 'Raw capture about the [[Render pipeline]].',
    })
    const note = store.pages[0]
    store = createKnowledgePage(store, {
      spaceId: store.activeSpaceId,
      kind: 'wiki',
      title: 'Render pipeline',
      body: 'The pipeline.',
    })
    const wiki = store.pages[0]

    // rename: slug follows the new title
    let proposed = proposeKnowledgeAgentChange(store, {
      spaceId: store.activeSpaceId,
      pageId: wiki.id,
      agentName: 'Steward',
      changeType: 'page.rename',
      title: 'Pure Render pipeline',
      summary: 'Names the pipeline by its product name.',
      patch: { title: 'Pure Render pipeline' },
    })
    let accepted = acceptKnowledgeAgentChange(
      proposed,
      proposed.agentChanges?.[0]?.id ?? '',
    )
    const renamed = accepted.pages.find(page => page.id === wiki.id)
    expect(renamed?.title).toBe('Pure Render pipeline')
    expect(renamed?.slug).toBe(slugifyPageTitle('Pure Render pipeline'))

    // promote: note becomes wiki with promotedAt stamped
    proposed = proposeKnowledgeAgentChange(accepted, {
      spaceId: accepted.activeSpaceId,
      pageId: note.id,
      agentName: 'Steward',
      changeType: 'page.promote',
      title: note.title,
      summary: 'The note has earned durability.',
      patch: {},
    })
    accepted = acceptKnowledgeAgentChange(
      proposed,
      proposed.agentChanges?.[0]?.id ?? '',
    )
    const promoted = accepted.pages.find(page => page.id === note.id)
    expect(promoted?.kind).toBe('wiki')
    expect(promoted?.promotedAt).toBeTruthy()

    // merge: survivor takes the merged body, source is deleted
    proposed = proposeKnowledgeAgentChange(accepted, {
      spaceId: accepted.activeSpaceId,
      pageId: note.id,
      agentName: 'Steward',
      changeType: 'page.merge',
      title: note.title,
      summary: 'Folds the notes into the pipeline page.',
      patch: { body: 'The pipeline, with the captured notes.', mergeIntoPageId: wiki.id },
    })
    accepted = acceptKnowledgeAgentChange(
      proposed,
      proposed.agentChanges?.[0]?.id ?? '',
    )
    expect(accepted.pages.find(page => page.id === note.id)).toBeUndefined()
    expect(accepted.pages.find(page => page.id === wiki.id)?.body).toBe(
      'The pipeline, with the captured notes.',
    )

    // delete: page removed on accept
    proposed = proposeKnowledgeAgentChange(accepted, {
      spaceId: accepted.activeSpaceId,
      pageId: wiki.id,
      agentName: 'Steward',
      changeType: 'page.delete',
      title: 'Pure Render pipeline',
      summary: 'Superseded by the architecture page.',
      patch: {},
    })
    accepted = acceptKnowledgeAgentChange(
      proposed,
      proposed.agentChanges?.[0]?.id ?? '',
    )
    expect(accepted.pages.find(page => page.id === wiki.id)).toBeUndefined()
  })

  it('attaches proposed links when a create proposal is accepted', () => {
    const initial = createDefaultKnowledgeStore()
    const proposed = proposeKnowledgeAgentChange(initial, {
      spaceId: initial.activeSpaceId,
      agentName: 'Steward',
      changeType: 'page.create',
      title: 'Team contacts',
      summary: 'Contact facts belong somewhere findable.',
      after: 'People we work with.',
      patch: {
        title: 'Team contacts',
        body: 'People we work with.',
        links: [{ type: 'url', title: 'Directory', url: 'https://example.test' }],
      },
    })
    const accepted = acceptKnowledgeAgentChange(
      proposed,
      proposed.agentChanges?.[0]?.id ?? '',
    )
    const created = accepted.pages.find(page => page.title === 'Team contacts')
    expect(created?.links).toHaveLength(1)
    expect(created?.links[0]).toMatchObject({ type: 'url', title: 'Directory' })
  })

  it('sweeps a space for broken links, orphans, stale pages, and duplicates', () => {
    let store = createDefaultKnowledgeStore()
    store = createKnowledgePage(store, {
      spaceId: store.activeSpaceId,
      kind: 'wiki',
      title: 'Alpha',
      body: 'Links to [[Missing page]].',
    })
    store = createKnowledgePage(store, {
      spaceId: store.activeSpaceId,
      kind: 'wiki',
      title: 'Beta',
      body: 'Nobody links here.',
    })
    store = createKnowledgePage(store, {
      spaceId: store.activeSpaceId,
      kind: 'wiki',
      title: 'beta',
      body: 'Duplicate by slug.',
    })
    const nowMs = Date.now() + KNOWLEDGE_STALE_AFTER_DAYS * 24 * 60 * 60 * 1000 + 1000
    const findings = reviewKnowledgeStore(store, store.activeSpaceId, nowMs)
    const kinds = new Set(findings.map(finding => finding.kind))
    expect(kinds.has('brokenLink')).toBe(true)
    expect(kinds.has('orphan')).toBe(true)
    expect(kinds.has('stale')).toBe(true)
    expect(kinds.has('duplicateTitle')).toBe(true)
    expect(
      findings.filter(finding => finding.kind === 'duplicateTitle'),
    ).toHaveLength(2)
  })

  it('applies agent writes directly and records them in the log', () => {
    const initial = createDefaultKnowledgeStore()
    const written = applyKnowledgeAgentChange(initial, {
      spaceId: initial.activeSpaceId,
      agentName: 'Steward',
      changeType: 'page.create',
      title: 'Deploy checklist',
      summary: 'Durable how-to from the release thread.',
      after: 'Steps to deploy.',
      patch: { title: 'Deploy checklist', body: 'Steps to deploy.' },
    })
    const page = written.pages.find(
      candidate => candidate.title === 'Deploy checklist',
    )
    expect(page?.body).toBe('Steps to deploy.')
    expect(written.agentChanges?.[0]).toMatchObject({
      status: 'applied',
      changeType: 'page.create',
      pageId: page?.id,
    })
    expect(written.activity[0]).toMatchObject({
      type: 'agentChange.applied',
      actorType: 'agent',
    })

    const updated = applyKnowledgeAgentChange(written, {
      spaceId: written.activeSpaceId,
      pageId: page?.id,
      agentName: 'Steward',
      changeType: 'page.update',
      title: 'Deploy checklist',
      summary: 'Adds the rollback step.',
      before: page?.body,
      after: 'Steps to deploy, then verify, then know how to roll back.',
      patch: { body: 'Steps to deploy, then verify, then know how to roll back.' },
    })
    expect(
      updated.pages.find(candidate => candidate.id === page?.id)?.body,
    ).toContain('roll back')
    expect(updated.agentChanges?.[0]?.before).toBe('Steps to deploy.')
  })

  it('rejects queued agent changes without applying them', () => {
    const initial = createDefaultKnowledgeStore()
    const page = initial.pages[0]
    const proposed = proposeKnowledgeAgentChange(initial, {
      spaceId: initial.activeSpaceId,
      pageId: page.id,
      agentName: 'Mail agent',
      changeType: 'page.update',
      title: 'Add mail summary',
      summary: 'Adds inbox context.',
      patch: { body: 'Mail summary' },
    })
    const rejected = rejectKnowledgeAgentChange(
      proposed,
      proposed.agentChanges?.[0]?.id ?? '',
    )

    expect(
      rejected.pages.find(candidate => candidate.id === page.id)?.body,
    ).toBe(page.body)
    expect(rejected.agentChanges?.[0]).toMatchObject({
      status: 'rejected',
    })
  })

  it('searches body, tags, and links', () => {
    const initial = createDefaultKnowledgeStore()
    const pageStore = createKnowledgePage(initial, {
      spaceId: initial.activeSpaceId,
      kind: 'wiki',
      title: 'Review pipeline',
      body: 'Agent QA decisions',
      tags: ['governance'],
    })
    const linked = addKnowledgeLink(pageStore, pageStore.pages[0].id, {
      path: '/tmp/audit.md',
      title: 'Audit trail',
    })
    expect(rankKnowledgePages(linked, 'governance')).toHaveLength(1)
    expect(rankKnowledgePages(linked, 'audit')).toHaveLength(1)
    expect(rankKnowledgePages(linked, 'missing')).toHaveLength(0)
  })

  it('extracts wiki links and finds backlinks', () => {
    const initial = createDefaultKnowledgeStore()
    const targetStore = createKnowledgePage(initial, {
      spaceId: initial.activeSpaceId,
      parentId: initial.spaces[0].rootPageId,
      kind: 'wiki',
      title: 'JSON export',
    })
    const target = targetStore.pages[0]
    const sourceStore = createKnowledgePage(targetStore, {
      spaceId: initial.activeSpaceId,
      parentId: initial.spaces[0].rootPageId,
      kind: 'wiki',
      title: 'Review notes',
      body: 'See [[JSON export]] and [[Missing page]].',
    })
    expect(extractWikiLinks(sourceStore.pages[0].body)).toEqual([
      'JSON export',
      'Missing page',
    ])
    expect(
      findPageByWikiTitle(sourceStore, initial.activeSpaceId, 'json export'),
    ).toMatchObject({
      id: target.id,
    })
    expect(
      findWikiBacklinks(sourceStore, target).map(page => page.title),
    ).toEqual(['Review notes'])
  })

  it('slugifies wiki page titles', () => {
    expect(slugifyPageTitle('  Agent QA: Review Flow! ')).toBe(
      'agent-qa-review-flow',
    )
  })

  it('normalizes resource links', () => {
    expect(
      normalizeKnowledgeLink({
        path: '/home/developer/PureScience/source.pdf',
      }),
    ).toMatchObject({
      type: 'file',
      title: 'source.pdf',
      path: '/home/developer/PureScience/source.pdf',
    })
  })
})

describe('rankKnowledgePages', () => {
  it('ranks title matches above body matches and returns snippets', () => {
    let store = createDefaultKnowledgeStore()
    const space = store.spaces[0]!
    store = createKnowledgePage(store, {
      spaceId: space.id,
      parentId: null,
      kind: 'wiki',
      title: 'Deployment checklist',
      body: 'Steps for a release.',
    })
    store = createKnowledgePage(store, {
      spaceId: space.id,
      parentId: null,
      kind: 'note',
      title: 'Meeting notes',
      body: 'We talked about the deployment cadence at length.',
    })

    const hits = rankKnowledgePages(store, 'deployment')
    expect(hits.length).toBeGreaterThanOrEqual(2)
    expect(hits[0]!.page.title).toBe('Deployment checklist')
    expect(hits[1]!.snippet).toContain('deployment cadence')
  })

  it('lists recently updated pages for an empty query', () => {
    let store = createDefaultKnowledgeStore()
    const space = store.spaces[0]!
    store = createKnowledgePage(store, {
      spaceId: space.id,
      parentId: null,
      kind: 'note',
      title: 'Newest',
      body: 'Fresh.',
    })
    const hits = rankKnowledgePages(store, '')
    expect(hits[0]!.page.title).toBe('Newest')
  })

  it('matches slugs and wikilink targets (folded-in substring search)', () => {
    let store = createDefaultKnowledgeStore()
    const space = store.spaces[0]!
    store = createKnowledgePage(store, {
      spaceId: space.id,
      parentId: null,
      kind: 'wiki',
      title: 'Render Pipeline',
      body: 'See [[Typesetting rules]] for details.',
    })
    // slug: render-pipeline
    expect(
      rankKnowledgePages(store, 'render-pipeline').map(hit => hit.page.title),
    ).toContain('Render Pipeline')
    // wikilink target text
    expect(
      rankKnowledgePages(store, 'typesetting').map(hit => hit.page.title),
    ).toContain('Render Pipeline')
  })

  it('records actor provenance on create, delete, and link activity', () => {
    const actor = { type: 'human' as const, name: 'You' }
    let store = createDefaultKnowledgeStore()
    store = createKnowledgePage(
      store,
      {
        spaceId: store.activeSpaceId,
        parentId: store.spaces[0]!.rootPageId,
        kind: 'wiki',
        title: 'Attributed',
      },
      { actor },
    )
    expect(store.activity[0]).toMatchObject({
      type: 'page.created',
      actorType: 'human',
      actorName: 'You',
    })
    const pageId = store.pages[0]!.id
    store = addKnowledgeLink(
      store,
      pageId,
      { title: 'Spec', url: 'https://example.test' },
      { actor },
    )
    expect(store.activity[0]).toMatchObject({
      type: 'link.created',
      actorType: 'human',
    })
    store = deleteKnowledgePage(store, pageId, { actor })
    expect(store.activity[0]).toMatchObject({
      type: 'page.deleted',
      actorType: 'human',
    })
  })
})
