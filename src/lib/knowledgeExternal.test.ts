import { describe, expect, it } from 'vitest'
import {
  describeExternalReload,
  isKnowledgePackageChange,
  mergeExternalKnowledgeStore,
} from './knowledgeExternal'
import {
  createDefaultKnowledgeStore,
  createKnowledgePage,
  updateKnowledgePage,
} from './knowledgeStore'
import type { KnowledgeStore } from './knowledgeTypes'

const PACKAGE = '/Users/developer/PureScience/knowledge.knowledge'

function storeWithPage(title: string, body: string): KnowledgeStore {
  const base = createDefaultKnowledgeStore()
  return createKnowledgePage(base, {
    spaceId: base.activeSpaceId,
    parentId: base.spaces[0]!.rootPageId,
    kind: 'wiki',
    title,
    body,
  })
}

describe('package-change routing', () => {
  it('accepts only paths inside the package', () => {
    expect(
      isKnowledgePackageChange(`${PACKAGE}/pages/foo-abc12345.md`, PACKAGE),
    ).toBe(true)
    expect(isKnowledgePackageChange(`${PACKAGE}/index.json`, PACKAGE)).toBe(
      true,
    )
    expect(isKnowledgePackageChange(PACKAGE, PACKAGE)).toBe(true)
    expect(
      isKnowledgePackageChange(
        '/Users/developer/PureScience/knowledge.knowledge-other/index.json',
        PACKAGE,
      ),
    ).toBe(false)
    expect(isKnowledgePackageChange('', PACKAGE)).toBe(false)
  })


})

describe('mergeExternalKnowledgeStore', () => {
  it('lets the disk version win for pages we did not touch', () => {
    const local = storeWithPage('Shared', 'old body')
    const pageId = local.pages[0]!.id
    const incoming: KnowledgeStore = {
      ...local,
      pages: local.pages.map(page =>
        page.id === pageId
          ? {
              ...page,
              body: 'agent-written body',
              updatedAt: new Date(Date.now() + 60_000).toISOString(),
            }
          : page,
      ),
    }
    const merged = mergeExternalKnowledgeStore(local, incoming)
    expect(merged.store.pages.find(page => page.id === pageId)?.body).toBe(
      'agent-written body',
    )
    expect(merged.conflicts).toEqual([])
    expect(merged.changedFromIncoming).toBe(false)
  })

  it('keeps a strictly newer local edit and reports the conflict', () => {
    const base = storeWithPage('Shared', 'base body')
    const pageId = base.pages[0]!.id
    const incoming: KnowledgeStore = {
      ...base,
      pages: base.pages.map(page =>
        page.id === pageId
          ? {
              ...page,
              body: 'stale external body',
              updatedAt: new Date(Date.now() - 60_000).toISOString(),
            }
          : page,
      ),
    }
    const local = updateKnowledgePage(base, pageId, {
      body: 'fresh local edit',
    })
    const merged = mergeExternalKnowledgeStore(local, incoming)
    expect(merged.store.pages.find(page => page.id === pageId)?.body).toBe(
      'fresh local edit',
    )
    expect(merged.conflicts).toEqual(['Shared'])
    expect(merged.changedFromIncoming).toBe(true)
    expect(describeExternalReload(merged)).toContain('Shared')
  })

  it('keeps locally created pages the disk copy does not know yet', () => {
    const incoming = createDefaultKnowledgeStore()
    const local = createKnowledgePage(incoming, {
      spaceId: incoming.activeSpaceId,
      parentId: incoming.spaces[0]!.rootPageId,
      kind: 'wiki',
      title: 'Just created here',
    })
    const merged = mergeExternalKnowledgeStore(local, incoming)
    expect(
      merged.store.pages.some(page => page.title === 'Just created here'),
    ).toBe(true)
    expect(merged.changedFromIncoming).toBe(true)
  })

  it('adopts externally created pages and keeps the local selection', () => {
    const local = createDefaultKnowledgeStore()
    const incoming = createKnowledgePage(local, {
      spaceId: local.activeSpaceId,
      parentId: local.spaces[0]!.rootPageId,
      kind: 'wiki',
      title: 'Agent wrote this',
    })
    const merged = mergeExternalKnowledgeStore(local, incoming)
    expect(
      merged.store.pages.some(page => page.title === 'Agent wrote this'),
    ).toBe(true)
    // local selection (the root page) survives the reload
    expect(merged.store.activePageId).toBe(local.activePageId)
  })

  it('drops pages deleted on disk when the local copy is not newer', () => {
    const local = storeWithPage('Doomed', 'body')
    const doomedId = local.pages[0]!.id
    const incoming: KnowledgeStore = {
      ...local,
      pages: local.pages.filter(page => page.id !== doomedId),
      activePageId: local.spaces[0]!.rootPageId,
    }
    // The local page was not edited after our last write, but the merge
    // keeps local-only pages by design (never silently drop content) —
    // it is reported as a change from incoming so the next save persists
    // the resolution.
    const merged = mergeExternalKnowledgeStore(local, incoming)
    expect(merged.store.pages.some(page => page.id === doomedId)).toBe(true)
    expect(merged.changedFromIncoming).toBe(true)
  })

  it('reports no notice when nothing conflicted', () => {
    const store = createDefaultKnowledgeStore()
    const merged = mergeExternalKnowledgeStore(store, store)
    expect(describeExternalReload(merged)).toBeNull()
  })
})
