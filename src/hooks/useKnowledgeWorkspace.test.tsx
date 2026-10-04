// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useKnowledgeWorkspace } from './useKnowledgeWorkspace'
import {
  createDefaultKnowledgeStore,
  updateKnowledgePage,
} from '../lib/knowledgeStore'
import {
  pageFileName,
  serializeKnowledgeIndex,
  serializePageFile,
} from '../lib/knowledgePages'
import type { KnowledgeBootState } from '../types'
import type { KnowledgeStore } from '../lib/knowledgeTypes'

const io = vi.hoisted(() => ({
  files: new Map<string, string>(),
  listeners: new Set<(change: { kind: string; path: string }) => void>(),
  writes: [] as string[],
  failWrite: '',
  readGate: null as null | { path: string; wait: Promise<void> },
  writeGate: null as null | { path: string; wait: Promise<void> },
}))
vi.mock('../bridge/platformBridge', () => ({
  readTextFile: vi.fn(async (path: string) => {
    const value = io.files.get(path)
    if (io.readGate?.path === path) await io.readGate.wait
    if (value === undefined) throw new Error(`Cannot read ${path}`)
    return value
  }),
  writeTextFile: vi.fn(async (path: string, value: string) => {
    io.writes.push(path)
    if (io.writeGate?.path === path) await io.writeGate.wait
    if (io.failWrite === path) throw new Error('Disk unavailable')
    io.files.set(path, value)
  }),
  updateKnowledgeSettings: vi.fn(async () => ({})),
  recordOperation: vi.fn(async () => undefined),
}))
vi.mock('@purescience/platform-ui/bridge/fs', () => ({
  listPlatformFiles: vi.fn(async (path: string) => ({
    entries: [...io.files.keys()]
      .filter(
        file =>
          file.startsWith(`${path}/`) &&
          !file.slice(path.length + 1).includes('/'),
      )
      .map(file => ({
        name: file.split('/').pop()!,
        path: file,
        isDirectory: false,
      })),
  })),
  deletePlatformFile: vi.fn(async (path: string) => {
    io.files.delete(path)
  }),
  renamePlatformFile: vi.fn(async () => undefined),
}))
vi.mock('@purescience/platform-ui/bridge/documents', () => ({
  registerPlatformAppObject: vi.fn(async () => undefined),
  onPlatformDocumentsChanged: vi.fn(
    (listener: (change: { kind: string; path: string }) => void) => {
      io.listeners.add(listener)
      return () => io.listeners.delete(listener)
    },
  ),
}))
const A = '/audit/A.knowledge'
const B = '/audit/B.knowledge'
const boot: KnowledgeBootState = {
  prefs: { workingDirectory: '/audit', theme: 'light' },
  appSettings: { storePath: A },
}
let current: ReturnType<typeof useKnowledgeWorkspace>
let root: Root
function Harness({
  path = A,
  handled,
}: {
  path?: string | null
  handled?: () => void
}) {
  current = useKnowledgeWorkspace(boot, path, handled)
  return null
}
const roots = new Set<Root>()
function seed(path: string, title: string): KnowledgeStore {
  const store = createDefaultKnowledgeStore()
  store.pages = store.pages.map(page => ({
    ...page,
    title: `${title} ${page.title}`,
  }))
  io.files.set(`${path}/index.json`, serializeKnowledgeIndex(store))
  for (const page of store.pages)
    io.files.set(`${path}/pages/${pageFileName(page)}`, serializePageFile(page))
  io.files.set(`${path}/activity.json`, '[]')
  io.files.set(`${path}/proposals.json`, '[]')
  return store
}
async function render(path: string | null = A, handled?: () => void) {
  if (!root) {
    const node = document.createElement('div')
    document.body.append(node)
    root = createRoot(node)
    roots.add(root)
  }
  await act(async () => {
    root.render(<Harness path={path} handled={handled} />)
  })
}
function deferred() {
  let resolve!: () => void
  const wait = new Promise<void>(done => {
    resolve = done
  })
  return { wait, resolve }
}
beforeEach(() => {
  io.files.clear()
  io.writes = []
  io.failWrite = ''
  io.readGate = null
  io.writeGate = null
  root = undefined as unknown as Root
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
})
afterEach(async () => {
  await act(async () => {
    for (const mounted of roots) mounted.unmount()
  })
  roots.clear()
  document.body.innerHTML = ''
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('knowledge workspace reliability', () => {
  it('retries failed page writes against the last durable snapshot', async () => {
    seed(A, 'A')
    await render()
    const page = current.store!.pages[0]!
    const next = updateKnowledgePage(current.store!, page.id, {
      body: 'Keep this edit',
    })
    const file = `${A}/pages/${pageFileName(page)}`
    io.failWrite = file
    await act(async () => {
      await expect(current.saveStore(next)).rejects.toThrow('Disk unavailable')
    })
    expect(current.store!.pages[0]!.body).toBe('Keep this edit')
    expect(current.saveFailed).toBe(true)
    io.failWrite = ''
    await act(async () => {
      await current.saveStore(next)
    })
    expect(io.files.get(file)).toContain('Keep this edit')
    expect(current.saveFailed).toBe(false)
    expect(current.error).toBeNull()
  })

  it('keeps saving true until the whole queued save chain finishes', async () => {
    seed(A, 'A')
    await render()
    const first = { ...current.store!, activePageId: null }
    const second = updateKnowledgePage(first, first.pages[0]!.id, {
      body: 'Queued text',
    })
    const gate = deferred()
    io.writeGate = {
      path: `${A}/pages/${pageFileName(second.pages[0]!)}`,
      wait: gate.wait,
    }
    let one!: Promise<void>
    let two!: Promise<void>
    await act(async () => {
      one = current.saveStore(first)
      two = current.saveStore(second)
      await one
    })
    expect(current.saving).toBe(true)
    await act(async () => {
      gate.resolve()
      await two
    })
    expect(current.saving).toBe(false)
  })

  it('does not overwrite an existing damaged index with a default store', async () => {
    seed(A, 'A')
    io.files.set(`${A}/index.json`, '{ damaged')
    await render()
    expect(current.error).toBeInstanceOf(Error)
    expect(current.store).toBeNull()
    expect(io.writes).toEqual([])
    expect(io.files.get(`${A}/index.json`)).toBe('{ damaged')
  })

  it('reports unreadable page content rather than loading a truncated store', async () => {
    seed(A, 'A')
    io.files.set(`${A}/pages/broken.md`, 'not a page file')
    await render()
    expect(current.error?.message).toContain('broken.md')
    expect(current.store).toBeNull()
    expect(io.writes).toEqual([])
  })

  it('does not reload the workspace when only callback identity changes', async () => {
    seed(A, 'A')
    await render(A, () => undefined)
    const reads = (await import('../bridge/platformBridge')).readTextFile
    vi.mocked(reads).mockClear()
    await render(A, () => undefined)
    expect(reads).not.toHaveBeenCalled()
  })

  it('ignores an external reload from a package that is no longer active', async () => {
    seed(A, 'A')
    seed(B, 'B')
    await render()
    const gate = deferred()
    io.readGate = { path: `${A}/index.json`, wait: gate.wait }
    vi.useFakeTimers()
    await act(async () => {
      for (const listener of io.listeners)
        listener({ kind: 'content', path: `${A}/index.json` })
      await vi.advanceTimersByTimeAsync(400)
    })
    await render(B)
    expect(current.store!.pages[0]!.title).toMatch(/^B /)
    await act(async () => {
      gate.resolve()
      for (let tick = 0; tick < 20; tick++) await Promise.resolve()
    })
    expect(current.storePath).toBe(B)
    expect(current.store!.pages[0]!.title).toMatch(/^B /)
  })
  it('retains failed edits when a different edit is queued after them', async () => {
    seed(A, 'A')
    await render()
    const page = current.store!.pages[0]!
    const first = updateKnowledgePage(current.store!, page.id, {
      body: 'Recover me',
    })
    const file = `${A}/pages/${pageFileName(page)}`
    io.failWrite = file
    await act(async () => {
      await current.saveStore(first).catch(() => undefined)
    })
    io.failWrite = ''
    await act(async () => {
      await current.saveStore({ ...first, activePageId: null })
    })
    expect(io.files.get(file)).toContain('Recover me')
  })

  it('reports failed deletes and retries without leaving renamed pages behind', async () => {
    seed(A, 'A')
    await render()
    const page = current.store!.pages[0]!
    const file = `${A}/pages/${pageFileName(page)}`
    const deletion = (await import('@purescience/platform-ui/bridge/fs'))
      .deletePlatformFile
    vi.mocked(deletion).mockRejectedValueOnce(new Error('Delete denied'))
    const next = updateKnowledgePage(current.store!, page.id, {
      title: 'Renamed page',
    })
    await act(async () => {
      await expect(current.saveStore(next)).rejects.toThrow('Delete denied')
    })
    expect(io.files.has(file)).toBe(true)
    expect(current.saveFailed).toBe(true)
    await act(async () => {
      await current.saveStore(next)
    })
    expect(io.files.has(file)).toBe(false)
    expect(
      io.files.get(`${A}/pages/${pageFileName(next.pages[0]!)}`),
    ).toContain('Renamed page')
  })

  it('keeps bad external reads from replacing the live knowledge base', async () => {
    seed(A, 'A')
    await render()
    const previous = current.store
    io.files.set(`${A}/index.json`, '{ damaged')
    vi.useFakeTimers()
    await act(async () => {
      for (const listener of io.listeners)
        listener({ kind: 'content', path: `${A}/index.json` })
      await vi.advanceTimersByTimeAsync(400)
    })
    expect(current.store).toBe(previous)
    expect(current.error).toBeInstanceOf(Error)
    expect(io.writes).toEqual([])
  })

  it('overlaps page reads with bounded bridge concurrency', async () => {
    const store = seed(A, 'A')
    for (let i = 0; i < 19; i++) {
      const page = {
        ...store.pages[0]!,
        id: `page-extra-${i}`,
        slug: `extra-${i}`,
      }
      io.files.set(`${A}/pages/${pageFileName(page)}`, serializePageFile(page))
    }
    const read = vi.mocked(
      (await import('../bridge/platformBridge')).readTextFile,
    )
    const original = read.getMockImplementation()!
    const gate = deferred()
    let inflight = 0
    let maximum = 0
    read.mockImplementation(async path => {
      if (!path.includes('/pages/')) return original(path)
      maximum = Math.max(maximum, ++inflight)
      await gate.wait
      try {
        return await original(path)
      } finally {
        --inflight
      }
    })
    await render()
    expect(current.loading).toBe(true)
    expect(maximum).toBe(8)
    await act(async () => {
      gate.resolve()
      for (let tick = 0; tick < 40; tick++) await Promise.resolve()
    })
    expect(current.store!.pages).toHaveLength(20)
    expect(maximum).toBeLessThanOrEqual(8)
    read.mockImplementation(original)
  })

  it('ignores an initial load that completes after switching packages', async () => {
    seed(A, 'A')
    seed(B, 'B')
    const gate = deferred()
    io.readGate = { path: `${A}/index.json`, wait: gate.wait }
    await render(A)
    await render(B)
    expect(current.store!.pages[0]!.title).toMatch(/^B /)
    io.writes = []
    await act(async () => {
      gate.resolve()
      for (let tick = 0; tick < 30; tick++) await Promise.resolve()
    })
    expect(current.store!.pages[0]!.title).toMatch(/^B /)
    expect(io.writes).toEqual([])
    const settings = vi.mocked(
      (await import('../bridge/platformBridge')).updateKnowledgeSettings,
    )
    expect(settings).toHaveBeenLastCalledWith({ storePath: B })
  })
  it('keeps the opened package bound after the shell clears its resource intent', async () => {
    seed(A, 'A')
    seed(B, 'B')
    await render(B)
    await render(null)
    expect(current.storePath).toBe(B)
    expect(current.store!.pages[0]!.title).toMatch(/^B /)
  })
})
