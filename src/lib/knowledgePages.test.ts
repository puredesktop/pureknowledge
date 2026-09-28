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

it('removes the previous filename after a renamed page is written', () => {
  const before = createDefaultKnowledgeStore()
  const page = before.pages[0]!
  const after = { ...before, pages: [{ ...page, title: 'Renamed', slug: 'renamed' }] }
  const plan = planKnowledgeWrites(before, after)
  expect(plan.writes.map(write => write.fileName)).toEqual([pageFileName(after.pages[0]!)])
  expect(plan.deletes).toEqual([pageFileName(page)])
})
it('loads the newest version of a duplicate identity regardless of directory order', () => {
  const store = createDefaultKnowledgeStore()
  const older = { ...store.pages[0]!, title: 'Old title', updatedAt: '2026-01-01T00:00:00Z', body: 'old' }
  const newer = { ...older, title: 'New title', updatedAt: '2026-01-02T00:00:00Z', body: 'new' }
  const other = { ...newer, id: 'different-page' }
  for (const pages of [[older, newer, other], [newer, older, other]]) {
    const result = assembleKnowledgeStore(JSON.parse(serializeKnowledgeIndex(store)), pages, [], [])
    expect(result.pages).toHaveLength(2)
    expect(result.pages.find(page => page.id === older.id)).toEqual(newer)
  }
})
