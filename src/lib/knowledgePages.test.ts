import { describe, expect, it } from 'vitest'
import {
  createDefaultKnowledgeStore,
  createKnowledgePage,
} from './knowledgeStore'
import {
  assembleKnowledgeStore,
  pageFileName,
  parsePageFile,
  planKnowledgeWrites,
  serializeKnowledgeIndex,
  serializePageFile,
} from './knowledgePages'

describe('knowledge page files', () => {
  it('round-trips a page through frontmatter + body', () => {
    let store = createDefaultKnowledgeStore()
    store = createKnowledgePage(store, {
      spaceId: store.spaces[0]!.id,
      parentId: null,
      kind: 'wiki',
      title: 'Deployment checklist',
      body: '# Steps\n\nSee [[Runbook]].',
      tags: ['ops'],
    })
    const page = store.pages[0]!
    const parsed = parsePageFile(serializePageFile(page))
    expect(parsed).toEqual(page)
    expect(pageFileName(page)).toMatch(/^deployment-checklist-[a-z0-9]+\.md$/i)
  })

  it('plans minimal writes: only the changed page touches disk', () => {
    let store = createDefaultKnowledgeStore()
    store = createKnowledgePage(store, {
      spaceId: store.spaces[0]!.id,
      parentId: null,
      kind: 'wiki',
      title: 'A',
      body: 'a',
    })
    store = createKnowledgePage(store, {
      spaceId: store.spaces[0]!.id,
      parentId: null,
      kind: 'wiki',
      title: 'B',
      body: 'b',
    })
    const edited = {
      ...store,
      pages: store.pages.map(page =>
        page.title === 'B' ? { ...page, body: 'b2' } : page,
      ),
      activity: store.activity,
    }
    const plan = planKnowledgeWrites(store, edited)
    expect(plan.writes).toHaveLength(1)
    expect(plan.writes[0]!.content).toContain('b2')
    expect(plan.deletes).toHaveLength(0)
    expect(plan.indexChanged).toBe(false)
    expect(plan.activityChanged).toBe(false)
  })

  it('assembles a store from the split files', () => {
    let store = createDefaultKnowledgeStore()
    store = createKnowledgePage(store, {
      spaceId: store.spaces[0]!.id,
      parentId: null,
      kind: 'note',
      title: 'Scratch',
      body: 'quick note',
    })
    const index = JSON.parse(serializeKnowledgeIndex(store))
    const assembled = assembleKnowledgeStore(
      index,
      store.pages,
      store.activity,
      store.agentChanges ?? [],
    )
    expect(assembled.pages).toEqual(store.pages)
    expect(assembled.activeSpaceId).toBe(store.activeSpaceId)
  })
})
