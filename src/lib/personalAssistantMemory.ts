import { applyKnowledgeAgentChange } from './knowledgeStore'
import type { KnowledgeStore, KnowledgePage } from './knowledgeTypes'
const ROOT = 'Personal assistant'
const TAG = 'personal-assistant-root'
export function assistantRoot(store: KnowledgeStore): KnowledgePage | null {
  const tagged = store.pages.filter(page => page.tags.includes(TAG))
  const matches = tagged.length
    ? tagged
    : store.pages.filter(
        page => page.title.toLowerCase() === ROOT.toLowerCase(),
      )
  if (matches.length > 1)
    throw new Error(
      'Several Personal assistant roots exist; choose the intended Knowledge collection before saving.',
    )
  return matches[0] ?? null
}
export function rememberAssistantFact(
  store: KnowledgeStore,
  input: {
    title: string
    body: string
    summary: string
    expectedUpdatedAt?: string
  },
) {
  for (const [key, limit] of [
    ['title', 160],
    ['body', 16000],
    ['summary', 500],
  ] as const) {
    if (
      typeof input[key] !== 'string' ||
      !input[key].trim() ||
      input[key].length > limit
    )
      throw new Error(
        `A non-empty ${key} of at most ${limit} characters is required`,
      )
  }
  let next = store,
    root = assistantRoot(store)
  if (!root) {
    const space =
      store.spaces.find(space => space.id === store.activeSpaceId) ??
      store.spaces[0]
    if (!space)
      throw new Error('Open a Knowledge collection before saving memory.')
    next = applyKnowledgeAgentChange(next, {
      spaceId: space.id,
      agentName: 'Personal assistant',
      changeType: 'page.create',
      title: ROOT,
      summary: 'Create the personal assistant memory root',
      after:
        'Durable facts, preferences and decisions saved by the personal assistant.',
      patch: {
        title: ROOT,
        body: 'Durable facts, preferences and decisions saved by the personal assistant.',
        kind: 'wiki',
        tags: ['directory', TAG],
        parentId: space.rootPageId,
      },
    })
    root = assistantRoot(next)!
  }
  const matches = next.pages.filter(
    page =>
      page.parentId === root!.id &&
      page.title.toLowerCase() === input.title.trim().toLowerCase(),
  )
  if (matches.length > 1)
    throw new Error(
      'Several matching memory pages exist; read and resolve them first.',
    )
  const existing = matches[0]
  if (existing && existing.body === input.body.trim())
    return { store, root, page: existing, unchanged: true }
  if (existing && input.expectedUpdatedAt !== existing.updatedAt)
    throw new Error(
      'Memory changed or was not read first. Read it and supply its current expectedUpdatedAt before updating.',
    )
  next = applyKnowledgeAgentChange(next, {
    spaceId: root.spaceId,
    ...(existing ? { pageId: existing.id } : {}),
    agentName: 'Personal assistant',
    changeType: existing ? 'page.update' : 'page.create',
    title: input.title.trim(),
    summary: input.summary.trim(),
    before: existing?.body,
    after: input.body.trim(),
    patch: {
      title: input.title.trim(),
      body: input.body.trim(),
      kind: 'wiki',
      parentId: root.id,
    },
  })
  // Background memory writes preserve the user's current selection.
  next = {
    ...next,
    activeSpaceId: store.activeSpaceId,
    activePageId: store.activePageId,
  }
  const page = next.pages.find(
    page => page.parentId === root!.id && page.title === input.title.trim(),
  )!
  return { store: next, root, page, unchanged: false }
}
