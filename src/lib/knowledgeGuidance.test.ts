import { describe, expect, it } from 'vitest'
import {
  createDefaultKnowledgeStore,
  createKnowledgePage,
  rankKnowledgePages,
  updateKnowledgePage,
} from './knowledgeStore'
import {
  parsePageFile,
  serializePageFile,
  assembleKnowledgeStore,
  serializeKnowledgeIndex,
} from './knowledgePages'
import {
  GUIDANCE_FILTERS,
  guidanceMetadata,
  replacementFor,
} from './knowledgeGuidance'
import type { KnowledgeStore } from './knowledgeTypes'

export function guidanceFixture() {
  let store = createDefaultKnowledgeStore()
  const ids: Record<string, string> = {}
  for (const [name, status] of [
    ['legacy', undefined],
    ['draft', 'draft'],
    ['current', 'current'],
    ['retired', 'retired'],
    ['unrelated', 'current'],
  ] as const) {
    store = createKnowledgePage(store, {
      spaceId: store.activeSpaceId,
      kind: 'note',
      title: name === 'unrelated' ? 'Other' : `Pipeline ${name}`,
      body: name === 'unrelated' ? 'Elsewhere' : `Original ${name} content`,
      tags: ['fixture'],
    })
    ids[name] = store.activePageId!
    if (status)
      store = updateKnowledgePage(store, store.activePageId!, {
        guidanceStatus: status,
      })
  }
  return { store, ids }
}
export function reload(store: KnowledgeStore) {
  return assembleKnowledgeStore(
    JSON.parse(serializeKnowledgeIndex(store)),
    store.pages.map((page) => parsePageFile(serializePageFile(page))!),
    store.activity,
    store.agentChanges ?? [],
  )
}

describe('manual guidance persistence', () => {
  it('retains identity, content, metadata and explicit checks through reload and independent edits', () => {
    let { store, ids } = guidanceFixture()
    const id = ids.retired!
    const check = {
      actorType: 'human' as const,
      actorName: 'You',
      at: '2026-10-01T00:00:00.000Z',
    }
    store = updateKnowledgePage(store, id, { lastChecked: check })
    for (const patch of [
      { body: 'Edited pipeline content' },
      { guidanceStatus: 'current' as const },
      { replacementPageId: ids.current! },
      { replacementPageId: ids.draft! },
    ]) {
      store = reload(updateKnowledgePage(store, id, patch))
      expect(store.pages.find((page) => page.id === id)?.lastChecked).toEqual(
        check,
      )
    }
    expect(store.pages.find((page) => page.id === id)).toMatchObject({
      id,
      body: 'Edited pipeline content',
      guidanceStatus: 'current',
      replacementPageId: ids.draft,
    })
    store = reload(
      updateKnowledgePage(store, id, {
        lastChecked: { ...check, at: '2026-10-02T00:00:00.000Z' },
      }),
    )
    expect(store.pages.find((page) => page.id === id)?.lastChecked?.at).toBe(
      '2026-10-02T00:00:00.000Z',
    )
  })
  it('preserves legacy fields without enrolling pages', () => {
    let { store, ids } = guidanceFixture()
    const original = store.pages.find((page) => page.id === ids.legacy)!
    store = reload(
      updateKnowledgePage(store, original.id, { body: 'Edited legacy' }),
    )
    const saved = store.pages.find((page) => page.id === original.id)!
    expect(saved).toMatchObject({
      ...original,
      body: 'Edited legacy',
      updatedAt: saved.updatedAt,
    })
    expect(saved).not.toHaveProperty('guidanceStatus')
    expect(saved).not.toHaveProperty('lastChecked')
  })
  it('rejects invalid metadata atomically, including missing, self and foreign notebook replacements', () => {
    const { store, ids } = guidanceFixture()
    const before = JSON.stringify(store)
    const disallowed = {
      ...store.pages[0]!,
      id: 'foreign',
      spaceId: 'not-in-notebook',
    }
    const scoped = { ...store, pages: [...store.pages, disallowed] }
    for (const patch of [
      { guidanceStatus: 'fresh' },
      {
        lastChecked: {
          actorType: 'human',
          actorName: 'You',
          at: '2026-02-30T00:00:00.000Z',
        },
      },
      {
        lastChecked: {
          actorType: 'human',
          actorName: '',
          at: '2026-10-01T00:00:00.000Z',
        },
      },
      { replacementPageId: ids.retired },
      { replacementPageId: 'missing' },
      { replacementPageId: 'foreign' },
    ]) {
      const snapshot = JSON.stringify(scoped)
      expect(() =>
        updateKnowledgePage(scoped, ids.retired!, patch as never),
      ).toThrow()
      expect(JSON.stringify(scoped)).toBe(snapshot)
    }
    expect(JSON.stringify(store)).toBe(before)
  })
  it('resolves replacements only by identity and treats removed targets as unavailable', () => {
    const { store, ids } = guidanceFixture()
    const saved = reload(
      updateKnowledgePage(store, ids.retired!, {
        replacementPageId: ids.current!,
      }),
    )
    const old = saved.pages.find((page) => page.id === ids.retired)!
    expect(old.body).toBe('Original retired content')
    expect(replacementFor(saved, old)?.id).toBe(ids.current)
    expect(
      replacementFor(
        {
          ...saved,
          pages: saved.pages.filter((page) => page.id !== ids.current),
        },
        old,
      ),
    ).toBeNull()
  })
})

describe('guidance search', () => {
  it('keeps matching, ranks Current first and relevance within groups, and filters every status', () => {
    const { store, ids } = guidanceFixture()
    const before = JSON.stringify(store)
    const hits = rankKnowledgePages(store, 'pipeline', 50)
    expect(hits.map((hit) => hit.page.id)).toEqual([
      ids.current,
      ids.draft,
      ids.legacy,
      ids.retired,
    ])
    expect(hits.map((hit) => guidanceMetadata(hit.page).statusLabel)).toEqual([
      'Current',
      'Draft',
      'Unmarked',
      'Retired',
    ])
    for (const status of GUIDANCE_FILTERS) {
      expect(
        rankKnowledgePages(store, 'pipeline', 50, status).map(
          (hit) => hit.page.id,
        ),
      ).toEqual(
        status === 'all'
          ? [ids.current, ids.draft, ids.legacy, ids.retired]
          : [ids[status === 'unmarked' ? 'legacy' : status]],
      )
    }
    expect(rankKnowledgePages(store, 'no-match', 50)).toEqual([])
    const revised = updateKnowledgePage(store, ids.legacy!, {
      guidanceStatus: 'current',
      title: 'Pipeline pipeline',
      body: 'Pipeline',
    })
    expect(rankKnowledgePages(revised, 'pipeline', 50)[0]?.page.id).toBe(
      ids.legacy,
    )
    expect(JSON.stringify(store)).toBe(before)
  })
})
