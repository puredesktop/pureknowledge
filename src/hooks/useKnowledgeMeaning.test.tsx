// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { embedTexts, getEmbeddingStatus, setupEmbeddings } from '@purescience/platform-ui/bridge/embeddings'
import { readTextFile, writeTextFile } from '../bridge/platformBridge'
import { createDefaultKnowledgeStore, createKnowledgePage, updateKnowledgePage } from '../lib/knowledgeStore'
import type { KnowledgeStore } from '../lib/knowledgeTypes'
import { useKnowledgeMeaning } from './useKnowledgeMeaning'

vi.mock('@purescience/platform-ui/bridge/embeddings', () => ({
  getEmbeddingStatus: vi.fn(),
  setupEmbeddings: vi.fn(),
  embedTexts: vi.fn(),
}))
vi.mock('../bridge/platformBridge', () => ({ readTextFile: vi.fn(), writeTextFile: vi.fn() }))

const model = { id: 'm', label: 'M', description: '', dimensions: 4, totalBytes: 34_000_000, licence: { name: 'MIT', url: '' }, source: { url: '', repo: '', revision: '' } }
const ready = { available: true, state: 'ready' as const, model }
const absent = { available: false, state: 'not-downloaded' as const, model }
const PATH = '/test/wiki.knowledge'
const SAVED = `${PATH}/search-index.json`

let root: Root
let current: ReturnType<typeof useKnowledgeMeaning>
let saved: string | null
function Harness({ store, path, heldCopy }: { store: KnowledgeStore | null; path: string; heldCopy?: boolean }) {
  current = useKnowledgeMeaning(store, path, { heldCopy })
  return null
}
const render = (store: KnowledgeStore | null, path = PATH, heldCopy = false) => act(async () => root.render(createElement(Harness, { store, path, heldCopy })))
const settled = () => vi.waitFor(() => expect(current.state.state).toBe('ready'), { timeout: 4000 })
const embedded = () => vi.mocked(embedTexts).mock.calls.flatMap(([request]) => request.purpose === 'passage' ? request.texts : [])

const library = () => {
  let store = createDefaultKnowledgeStore()
  store = createKnowledgePage(store, { spaceId: store.activeSpaceId, parentId: store.spaces[0]!.rootPageId, kind: 'wiki', title: 'Fundraising', body: 'Talking to investors.' })
  return store
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  root = createRoot(document.createElement('div'))
  saved = null
  vi.mocked(getEmbeddingStatus).mockResolvedValue(ready)
  vi.mocked(embedTexts).mockImplementation(async ({ texts }) => ({ modelId: 'm', dimensions: 4, vectors: texts.map(() => [1, 0, 0, 0]) }))
  vi.mocked(readTextFile).mockImplementation(async () => {
    if (saved === null) throw new Error('missing')
    return saved
  })
  vi.mocked(writeTextFile).mockImplementation(async (_path, content) => { saved = content })
})
afterEach(async () => {
  await act(async () => root.unmount())
  vi.resetAllMocks()
})

describe('a held copy of the app', () => {
  const index = async () => {
    await render(library())
    await settled()
    await act(async () => root.unmount())
    root = createRoot(document.createElement('div'))
    vi.mocked(embedTexts).mockClear()
    vi.mocked(writeTextFile).mockClear()
    return saved
  }

  it('reads the saved index and neither embeds a page nor writes the file', async () => {
    const before = await index()
    await render(library(), PATH, true)
    await settled()
    expect(embedded()).toEqual([])
    expect(writeTextFile).not.toHaveBeenCalled()
    expect(saved).toBe(before)
    expect(current.index()).not.toBeNull()
    expect(Object.keys(current.index()!.pages).length).toBeGreaterThan(0)
  })

  it('leaves new pages to the normal tab, and still reads them by words: it says ready, never that it is working', async () => {
    await index()
    await render(createKnowledgePage(library(), { spaceId: 's', kind: 'wiki', title: 'New', body: 'Words nobody has read yet.' }), PATH, true)
    await settled()
    expect(embedded()).toEqual([])
    expect(writeTextFile).not.toHaveBeenCalled()
    expect(current.state.state).toBe('ready')
  })

  it('with no index at all it still makes none', async () => {
    await render(library(), PATH, true)
    await settled()
    expect(embedded()).toEqual([])
    expect(writeTextFile).not.toHaveBeenCalled()
    expect(saved).toBeNull()
  })

  it('takes up what the normal tab saved when it next looks', async () => {
    const written = await index()
    saved = null
    await render(library(), PATH, true)
    await settled()
    expect(Object.keys(current.index()!.pages)).toEqual([])
    saved = written
    await render({ ...library() }, PATH, true)
    await vi.waitFor(() => expect(Object.keys(current.index()!.pages).length).toBeGreaterThan(0), { timeout: 4000 })
  })

  it('still asks the model about a question: a search is not background work', async () => {
    await index()
    await render(library(), PATH, true)
    await settled()
    await current.vector('who are the investors?')
    expect(vi.mocked(embedTexts).mock.calls.at(-1)?.[0].purpose).toBe('query')
  })
})

describe('useKnowledgeMeaning', () => {
  it('runs nothing and offers set-up while the model is not on the computer', async () => {
    vi.mocked(getEmbeddingStatus).mockResolvedValue(absent)
    await render(library())
    await vi.waitFor(() => expect(current.state.state).toBe('absent'))
    expect(current.state.totalBytes).toBe(34_000_000)
    expect(current.index()).toBeNull()
    await expect(current.vector('who are our backers')).resolves.toBeNull()
    expect(embedTexts).not.toHaveBeenCalled()
    vi.mocked(setupEmbeddings).mockResolvedValue({ ...absent, state: 'downloading' })
    vi.mocked(getEmbeddingStatus).mockResolvedValue({ ...absent, state: 'downloading' })
    await act(async () => current.setUp())
    await vi.waitFor(() => expect(current.state.state).toBe('downloading'))
  })

  it('says it cannot search by meaning on a host without the service', async () => {
    vi.mocked(getEmbeddingStatus).mockResolvedValue({ available: false, state: 'unsupported', error: 'No such method' })
    await render(library())
    await vi.waitFor(() => expect(current.state.state).toBe('unsupported'))
  })

  it('builds and saves the index, then a restart reads it back without embedding again', async () => {
    const store = library()
    await render(store)
    await settled()
    expect(writeTextFile).toHaveBeenCalledWith(SAVED, expect.any(String))
    expect(Object.keys(current.index()!.pages).length).toBe(store.pages.length)
    await act(async () => root.unmount())

    vi.mocked(embedTexts).mockClear()
    root = createRoot(document.createElement('div'))
    await render(store)
    await settled()
    expect(embedded()).toEqual([])
    expect(Object.keys(current.index()!.pages).length).toBe(store.pages.length)
  })

  it('reads only what changed when a page is edited', async () => {
    const store = library()
    await render(store)
    await settled()
    vi.mocked(embedTexts).mockClear()
    const id = store.pages.find(page => page.title === 'Fundraising')!.id
    await render(updateKnowledgePage(store, id, { body: 'Talking to backers instead.' }))
    await vi.waitFor(() => expect(embedded().length).toBeGreaterThan(0), { timeout: 4000 })
    await settled()
    expect(embedded().every(text => text.includes('Fundraising'))).toBe(true)
  })

  it('says search stopped when the model fails, keeps finished pages, and can try again', async () => {
    vi.mocked(embedTexts).mockRejectedValueOnce(new Error('stopped'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const store = library()
    await render(store)
    await vi.waitFor(() => expect(current.state.state).toBe('failed'))
    spy.mockRestore()
    await act(async () => current.retry())
    await settled()
    expect(Object.keys(current.index()!.pages).length).toBe(store.pages.length)
  })

  it('remembers a question, and answers words when the model cannot', async () => {
    await render(library())
    await settled()
    vi.mocked(embedTexts).mockClear()
    await expect(current.vector('our backers')).resolves.toEqual([1, 0, 0, 0])
    await expect(current.vector('our backers')).resolves.toEqual([1, 0, 0, 0])
    expect(embedTexts).toHaveBeenCalledTimes(1)
    await expect(current.vector('ab')).resolves.toBeNull()
    vi.mocked(embedTexts).mockRejectedValueOnce(new Error('gone'))
    await expect(current.vector('another question')).resolves.toBeNull()
  })

  it('keeps each library to its own index', async () => {
    const store = library()
    await render(store)
    await settled()
    const other = '/test/other.knowledge'
    saved = null
    await render(store, other)
    await vi.waitFor(() => expect(writeTextFile).toHaveBeenCalledWith(`${other}/search-index.json`, expect.any(String)), { timeout: 4000 })
  })
})
