import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../bridge/platformBridge', () => ({
  recordOperation: vi.fn(async () => null),
}))
vi.mock('../bridge/knowledgeAssets', () => ({
  importKnowledgeImages: vi.fn(async () => []),
}))

import { recordOperation } from '../bridge/platformBridge'
import { importKnowledgeImages } from '../bridge/knowledgeAssets'
import {
  applyKnowledgeChangeHandler,
  getKnowledgeContextHandler,
  readKnowledgePageHandler,
  searchKnowledgeHandler,
} from './handlers'
import type { KnowledgeAgentToolContext } from './catalog'
import {
  createDefaultKnowledgeStore,
  createKnowledgePage,
} from '../lib/knowledgeStore'

function contextFor(
  store: ReturnType<typeof createDefaultKnowledgeStore> | null,
): KnowledgeAgentToolContext {
  return {
    store,
    saveStore: async () => undefined,
    storePath: '/Users/developer/PureScience/knowledge.knowledge',
  }
}

describe('getKnowledgeContext', () => {
  it('returns the compact call-this-first context', () => {
    let store = createDefaultKnowledgeStore()
    store = createKnowledgePage(store, {
      spaceId: store.activeSpaceId,
      parentId: store.spaces[0]!.rootPageId,
      kind: 'note',
      title: 'Scratch note',
    })
    const result = getKnowledgeContextHandler(contextFor(store))
    const parsed = JSON.parse(result.content) as Record<string, unknown>
    expect(parsed.storePath).toBe(
      '/Users/developer/PureScience/knowledge.knowledge',
    )
    expect(parsed.activeSpace).toMatchObject({ id: store.activeSpaceId })
    expect(parsed.activePage).toMatchObject({
      title: 'Scratch note',
      kind: 'note',
    })
    expect(parsed.totalPages).toBe(2)
    expect(parsed.wikiPages).toBe(1)
    expect(parsed.notes).toBe(1)
    expect(Array.isArray(parsed.spaces)).toBe(true)
  })

  it('reports a loading store as a retryable error', () => {
    const result = getKnowledgeContextHandler(contextFor(null))
    expect(result.content).toContain('still loading')
  })
})

describe('applyKnowledgeChange ledger wiring', () => {
  beforeEach(() => {
    vi.mocked(recordOperation).mockClear()
    vi.mocked(importKnowledgeImages).mockClear()
  })

  it('records an agent-lane operation after a successful write', async () => {
    const store = createDefaultKnowledgeStore()
    const result = await applyKnowledgeChangeHandler(contextFor(store), {
      action: 'create',
      title: 'Deploy checklist',
      body: 'Steps.',
      summary: 'Durable how-to.',
      agentName: 'Steward',
    })
    expect(result.content).toContain('applied')
    expect(recordOperation).toHaveBeenCalledTimes(1)
    expect(vi.mocked(recordOperation).mock.calls[0]![0]).toMatchObject({
      lane: 'agent',
      kind: 'knowledge.page.create',
      appSlug: 'knowledge',
      summary: 'Steward: Durable how-to.',
    })
  })

  it('accepts empty image lists for text-only creates and updates without importing files', async () => {
    let saved = createDefaultKnowledgeStore()
    const context = { ...contextFor(saved), saveStore: async (next: typeof saved) => { saved = next } }
    const created = await applyKnowledgeChangeHandler(context, {
      action: 'create', title: 'Career evidence', body: 'Supported facts.', summary: 'Save evidence.', importAssets: [],
    })
    expect(created.content).toContain('applied')
    const page = saved.pages.find(page => page.title === 'Career evidence')!
    const updated = await applyKnowledgeChangeHandler({ ...context, store: saved }, {
      action: 'update', page: page.id, body: 'Updated facts.', summary: 'Update evidence.', importAssets: [],
    })
    expect(updated.content).toContain('applied')
    expect(saved.pages.find(item => item.id === page.id)?.body).toBe('Updated facts.')
    expect(importKnowledgeImages).not.toHaveBeenCalled()
  })

  it('still refuses an empty image-only write and malformed image arguments', async () => {
    const context = contextFor(createDefaultKnowledgeStore())
    const empty = await applyKnowledgeChangeHandler(context, {
      action: 'create', title: 'Empty page', summary: 'Create.', importAssets: [],
    })
    expect(empty.content).toContain('Pass "body"')
    const malformed = await applyKnowledgeChangeHandler(context, {
      action: 'create', title: 'Text', body: 'Text.', summary: 'Create.', importAssets: 'not an array',
    })
    expect(malformed.content).toContain('must be an array')
    expect(importKnowledgeImages).not.toHaveBeenCalled()
  })

  it('does not record when the write is refused', async () => {
    const store = createDefaultKnowledgeStore()
    const result = await applyKnowledgeChangeHandler(contextFor(store), {
      action: 'create',
      title: '_index',
      body: 'dupe',
      summary: 'dupe',
    })
    expect(result.content).toContain('already exists')
    expect(recordOperation).not.toHaveBeenCalled()
  })

  it('bulk-imports images, appends inline markdown, and attaches copied files', async () => {
    let saved = createDefaultKnowledgeStore()
    const context = {
      ...contextFor(saved),
      saveStore: async (next: typeof saved) => {
        saved = next
      },
    }
    vi.mocked(importKnowledgeImages).mockResolvedValueOnce([
      {
        sourcePath: '/Brand/logo.svg',
        relativePath: 'assets/logo-1.svg',
        absolutePath: '/Users/developer/PureScience/knowledge.knowledge/assets/logo-1.svg',
        alt: 'Pure logo',
        markdown: '![Pure logo](assets/logo-1.svg)',
      },
      {
        sourcePath: '/Brand/slide.png',
        relativePath: 'assets/slide-2.png',
        absolutePath: '/Users/developer/PureScience/knowledge.knowledge/assets/slide-2.png',
        alt: 'Pitch slide',
        markdown: '![Pitch slide](assets/slide-2.png)',
      },
    ])

    const result = await applyKnowledgeChangeHandler(context, {
      action: 'create',
      title: 'Brand gallery',
      body: 'Approved brand images.',
      summary: 'Create the brand gallery.',
      importAssets: [
        { sourcePath: '/Brand/logo.svg', alt: 'Pure logo' },
        { sourcePath: '/Brand/slide.png', alt: 'Pitch slide' },
      ],
    })

    expect(importKnowledgeImages).toHaveBeenCalledWith(
      context.storePath,
      expect.arrayContaining([{ sourcePath: '/Brand/logo.svg', alt: 'Pure logo' }]),
    )
    const page = saved.pages.find(candidate => candidate.title === 'Brand gallery')
    expect(page?.body).toContain('![Pure logo](assets/logo-1.svg)')
    expect(page?.body).toContain('![Pitch slide](assets/slide-2.png)')
    expect(page?.links).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'file', title: 'Pure logo', path: expect.stringContaining('/assets/logo-1.svg') }),
        expect.objectContaining({ type: 'file', title: 'Pitch slide', path: expect.stringContaining('/assets/slide-2.png') }),
      ]),
    )
    const output = JSON.parse(result.content) as { importedAssets: unknown[] }
    expect(output.importedAssets).toHaveLength(2)
  })

  it('rejects relative import paths before writing', async () => {
    const store = createDefaultKnowledgeStore()
    const result = await applyKnowledgeChangeHandler(contextFor(store), {
      action: 'create',
      title: 'Brand gallery',
      body: 'Images.',
      summary: 'Create the brand gallery.',
      importAssets: [{ sourcePath: 'Brand/logo.svg' }],
    })
    expect(result.content).toContain('absolute local path')
    expect(importKnowledgeImages).not.toHaveBeenCalled()
  })

  it('appends an asset-only update to the existing body', async () => {
    let saved = createDefaultKnowledgeStore()
    saved = createKnowledgePage(saved, {
      spaceId: saved.activeSpaceId,
      parentId: saved.spaces[0]!.rootPageId,
      kind: 'wiki',
      title: 'Brand guide',
      body: 'Keep this introduction.',
    })
    const context = {
      ...contextFor(saved),
      saveStore: async (next: typeof saved) => {
        saved = next
      },
    }
    vi.mocked(importKnowledgeImages).mockResolvedValueOnce([
      {
        sourcePath: '/Brand/logo.svg',
        relativePath: 'assets/logo.svg',
        absolutePath: `${context.storePath}/assets/logo.svg`,
        alt: 'Pure logo',
        markdown: '![Pure logo](assets/logo.svg)',
      },
    ])

    await applyKnowledgeChangeHandler(context, {
      action: 'update',
      page: 'Brand guide',
      summary: 'Add the approved logo.',
      importAssets: [{ sourcePath: '/Brand/logo.svg', alt: 'Pure logo' }],
    })

    const page = saved.pages.find(candidate => candidate.title === 'Brand guide')
    expect(page?.body).toBe(
      'Keep this introduction.\n\n![Pure logo](assets/logo.svg)',
    )
  })
})

describe('searchKnowledge (unified ranking)', () => {
  it('uses the ranked implementation shared with the sidebar', () => {
    let store = createDefaultKnowledgeStore()
    store = createKnowledgePage(store, {
      spaceId: store.activeSpaceId,
      parentId: store.spaces[0]!.rootPageId,
      kind: 'wiki',
      title: 'Deployment checklist',
      body: 'Steps for a release.',
    })
    const result = searchKnowledgeHandler(contextFor(store), {
      query: 'deployment',
    })
    const parsed = JSON.parse(result.content) as {
      pages: Array<{ title: string }>
    }
    expect(parsed.pages[0]?.title).toBe('Deployment checklist')
  })
})

/**
 * The reported flow: the agent creates several wiki pages in one burst,
 * then the next mission ("improve how the wiki is organised") lists spaces
 * and searches. Every tool invoke must SETTLE (never hang) and read the
 * freshly-written store. Drive the real handler path against a mutable
 * context whose async saveStore mirrors the workspace's chained save, so a
 * dropped/awaited response would surface here as a hang or stale read.
 */
describe('burst create then search (regression)', () => {
  function liveContext(): KnowledgeAgentToolContext & {
    saveChain: Promise<void>
  } {
    const ctx = {
      store: createDefaultKnowledgeStore(),
      storePath: '/Users/developer/PureScience/knowledge.knowledge',
      saveChain: Promise.resolve(),
    } as KnowledgeAgentToolContext & { saveChain: Promise<void> }
    ctx.saveStore = (next) => {
      // Commit synchronously the way the workspace does (setStore before the
      // write settles), then chain the "write" so overlapping calls queue.
      ctx.store = next
      ctx.saveChain = ctx.saveChain.then(
        () => new Promise<void>(resolve => setTimeout(resolve, 1)),
      )
      return ctx.saveChain
    }
    return ctx
  }

  it('settles every invoke and searches the just-created pages', async () => {
    const ctx = liveContext()
    const titles = ['Project Overview', 'Team', 'Roadmap']
    for (const title of titles) {
      const result = await applyKnowledgeChangeHandler(ctx, {
        action: 'create',
        title,
        body: `${title} body. See [[${titles[0]}]].`,
        summary: `Seed ${title}.`,
      })
      expect(result.content).toContain('applied')
    }
    await ctx.saveChain

    const search = searchKnowledgeHandler(ctx, { query: 'roadmap' })
    const parsed = JSON.parse(search.content) as {
      totalPages: number
      pages: Array<{ title: string }>
    }
    expect(parsed.pages[0]?.title).toBe('Roadmap')
    expect(parsed.totalPages).toBeGreaterThanOrEqual(3)

    // An empty-query search (the "list recent" branch) must also return.
    const recent = searchKnowledgeHandler(ctx, {})
    expect(() => JSON.parse(recent.content)).not.toThrow()
  })
})

describe('readKnowledgePage (asking for less)', () => {
  const sectionText = (n: number) => `## Part ${n}\n\n` + `Line about part ${n}. `.repeat(60) + '\n\n'
  function longPage() {
    let store = createDefaultKnowledgeStore()
    store = createKnowledgePage(store, {
      spaceId: store.activeSpaceId,
      parentId: store.spaces[0]!.rootPageId,
      kind: 'wiki',
      title: 'Render pipeline',
      body: '# Render pipeline\n\nIntro.\n\n' + [1, 2, 3, 4, 5, 6, 7, 8].map(sectionText).join(''),
    })
    return store
  }
  const read = (args: Record<string, unknown>) =>
    JSON.parse(readKnowledgePageHandler(contextFor(longPage()), { page: 'Render pipeline', ...args }).content)

  it('still returns the whole body by default', () => {
    const page = read({})
    expect(page.body).toContain('## Part 8')
    expect(page).not.toHaveProperty('nextOffset')
  })
  it('returns one section by heading, with the outline and length', () => {
    const full = read({})
    const part = read({ section: 'Part 3' })
    expect(part.body.startsWith('## Part 3')).toBe(true)
    expect(part.body).not.toContain('## Part 4')
    expect(part.bodyCharacters).toBe(full.body.length)
    expect(part.sections.map((s: { heading: string }) => s.heading)).toContain('Part 7')
    expect(part.nextOffset).toBeNull()
    expect(JSON.stringify(part).length).toBeLessThan(JSON.stringify(full).length / 3)
  })
  it('pages through the body with offset and maxChars', () => {
    const full = read({}).body as string
    const first = read({ maxChars: 1000 })
    expect(first.body).toBe(full.slice(0, 1000))
    const second = read({ offset: first.nextOffset, maxChars: 1000 })
    expect(second.body).toBe(full.slice(1000, 2000))
    expect(read({ offset: full.length - 10 }).nextOffset).toBeNull()
  })
  it('names the headings when the section is missing, and refuses a bad range', () => {
    const missing = readKnowledgePageHandler(contextFor(longPage()), { page: 'Render pipeline', section: 'Nope' })
    expect(missing.content).toContain('Part 2')
    const bad = readKnowledgePageHandler(contextFor(longPage()), { page: 'Render pipeline', maxChars: 0 })
    expect(bad.content).toContain('maxChars')
  })
})
