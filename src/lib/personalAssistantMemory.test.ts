import { describe, expect, it } from 'vitest'
import {
  createDefaultKnowledgeStore,
  createKnowledgePage,
} from './knowledgeStore'
import { assistantRoot, rememberAssistantFact } from './personalAssistantMemory'
const input = {
  title: 'Travel preferences',
  body: 'Prefer window seats.',
  summary: 'Remember the requested seat preference',
}
describe('personal assistant Knowledge memory', () => {
  it('creates one audited root and child while preserving the current page', () => {
    const store = createDefaultKnowledgeStore(),
      result = rememberAssistantFact(store, input)
    expect(result.root.title).toBe('Personal assistant')
    expect(result.page.parentId).toBe(result.root.id)
    expect(result.store.activePageId).toBe(store.activePageId)
    expect(result.store.agentChanges).toHaveLength(2)
    expect(rememberAssistantFact(result.store, input).store).toBe(result.store)
  })
  it('requires a current revision before replacing a remembered fact', () => {
    const result = rememberAssistantFact(createDefaultKnowledgeStore(), input)
    expect(() =>
      rememberAssistantFact(result.store, {
        ...input,
        body: 'Prefer aisle seats.',
      }),
    ).toThrow('Read it')
    const changed = rememberAssistantFact(result.store, {
      ...input,
      body: 'Prefer aisle seats.',
      expectedUpdatedAt: result.page.updatedAt,
    })
    expect(changed.page.body).toBe('Prefer aisle seats.')
    expect(changed.store.agentChanges?.[0].before).toBe(input.body)
  })
  it('keeps an unrelated page with the same title intact', () => {
    let store = createDefaultKnowledgeStore()
    store = createKnowledgePage(store, {
      kind: 'wiki',
      spaceId: store.activeSpaceId,
      title: input.title,
      body: 'Unrelated',
    })
    const original = store.pages.find(p => p.title === input.title)!
    const result = rememberAssistantFact(store, input)
    expect(result.page.id).not.toBe(original.id)
    expect(result.store.pages.find(p => p.id === original.id)?.body).toBe(
      'Unrelated',
    )
  })
  it('refuses to choose silently between multiple existing roots', () => {
    let store = createDefaultKnowledgeStore()
    store = createKnowledgePage(store, {
      kind: 'wiki',
      spaceId: store.activeSpaceId,
      title: 'Personal assistant',
    })
    store = createKnowledgePage(store, {
      kind: 'wiki',
      spaceId: store.activeSpaceId,
      title: 'Personal assistant',
    })
    expect(() => assistantRoot(store)).toThrow('Several')
  })
})
