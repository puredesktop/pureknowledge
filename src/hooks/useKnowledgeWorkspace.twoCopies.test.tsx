// @vitest-environment happy-dom
/**
 * Two live copies of PureKnowledge over one package: a normal tab and a copy held inside a page. Each test mounts two real
 * useKnowledgeWorkspace hooks over one fake filesystem. `events` decides whether the shell's change events reach the other
 * copy: off is a copy held in a room, which the shell tells nothing, and a copy whose event has not arrived yet.
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useKnowledgeWorkspace } from './useKnowledgeWorkspace'
import {
  acceptKnowledgeAgentChange,
  createDefaultKnowledgeStore,
  createKnowledgePage,
  createKnowledgeSpace,
  deleteKnowledgePage,
  proposeKnowledgeAgentChange,
  updateKnowledgePage,
} from '../lib/knowledgeStore'
import {
  pageFileName,
  parsePageFile,
  serializeKnowledgeActivity,
  serializeKnowledgeIndex,
  serializeKnowledgeProposals,
  serializePageFile,
} from '../lib/knowledgePages'
import type { KnowledgeBootState } from '../types'
import type { KnowledgePage, KnowledgeStore } from '../lib/knowledgeTypes'

const io = vi.hoisted(() => ({
  files: new Map<string, string>(),
  storage: new Map<string, { value: unknown; version: string }>(),
  listeners: new Set<(change: { kind: string; path: string; source?: unknown }) => void>(),
  events: false,
  writer: null as unknown,
  /** One tick per bridge call, so two copies' read-then-write really can interleave. */
  tick: () => new Promise<void>(resolve => setTimeout(resolve, 0)),
  settings: [] as unknown[],
}))

vi.mock('../bridge/platformBridge', () => ({
  readTextFile: vi.fn(async (path: string) => {
    await io.tick()
    const value = io.files.get(path)
    if (value === undefined) throw new Error(`ENOENT ${path}`)
    return value
  }),
  writeTextFile: vi.fn(async (path: string, value: string) => {
    await io.tick()
    io.files.set(path, value)
    if (io.events) for (const listener of io.listeners) listener({ kind: 'content', path, source: io.writer })
  }),
  updateKnowledgeSettings: vi.fn(async (patch: unknown) => { io.settings.push(patch); return {} }),
  recordOperation: vi.fn(async () => undefined),
}))
vi.mock('@purescience/platform-ui/bridge/fs', () => ({
  listPlatformFiles: vi.fn(async (path: string) => {
    await io.tick()
    return {
      entries: [...io.files.keys()]
        .filter(file => file.startsWith(`${path}/`) && !file.slice(path.length + 1).includes('/'))
        .map(file => ({ name: file.split('/').pop()!, path: file, isDirectory: false, byteLength: io.files.get(file)!.length, modifiedAt: '' })),
    }
  }),
  deletePlatformFile: vi.fn(async (path: string) => {
    await io.tick()
    if (!io.files.delete(path)) throw new Error(`ENOENT ${path}`)
    if (io.events) for (const listener of io.listeners) listener({ kind: 'content', path, source: io.writer })
  }),
  renamePlatformFile: vi.fn(async () => undefined),
}))
vi.mock('@purescience/platform-ui/bridge/documents', () => ({
  registerPlatformAppObject: vi.fn(async () => undefined),
  onPlatformDocumentsChanged: vi.fn((listener: (change: { kind: string; path: string }) => void) => {
    io.listeners.add(listener)
    return () => io.listeners.delete(listener)
  }),
}))
// The shell's conditional JSON write, as modules/storage/jsonStore.ts does it: one at a time, atomic in the main process.
vi.mock('@purescience/platform-ui/bridge/storage', () => ({
  readPlatformStorageJson: vi.fn(async ({ fileName }: { fileName: string }) => {
    await io.tick()
    const held = io.storage.get(fileName)
    return { path: `/.appdata/${fileName}`, value: held?.value ?? null, version: held?.version ?? null }
  }),
  writePlatformStorageJson: vi.fn(async ({ fileName, value, ifMatch }: { fileName: string; value: unknown; ifMatch?: string | null }) => {
    await io.tick()
    const held = io.storage.get(fileName)
    if (ifMatch !== undefined && (held?.version ?? null) !== ifMatch) return { path: '', ok: false, conflict: true, value: held?.value ?? null, version: held?.version ?? null }
    const version = `${fileName}#${Math.random()}`
    io.storage.set(fileName, { value, version })
    return { path: '', ok: true, version }
  }),
}))

const PACKAGE = '/desk/wiki.knowledge'
type Workspace = ReturnType<typeof useKnowledgeWorkspace>
const bootFor = (heldCopy: boolean): KnowledgeBootState => ({
  prefs: { workingDirectory: '/desk', theme: 'light' },
  appSettings: { storePath: PACKAGE },
  heldCopy,
})

const roots: Root[] = []
function mount(heldCopy: boolean): { current: () => Workspace; start: () => void } {
  let latest: Workspace | undefined
  const boot = bootFor(heldCopy)
  function Harness() {
    latest = useKnowledgeWorkspace(boot, PACKAGE)
    return null
  }
  const root = createRoot(document.createElement('div'))
  roots.push(root)
  return { current: () => latest!, start: () => root.render(<Harness />) }
}
async function open(heldCopy = false): Promise<{ current: () => Workspace }> {
  const copy = mount(heldCopy)
  await act(async () => { copy.start() })
  await settle(() => Boolean(copy.current()?.store))
  return copy
}
async function settle(until: () => boolean = () => false, ms = 1500): Promise<void> {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)) })
    if (until()) return
  }
}

function seed(titles: string[] = ['Shared', 'Other']): KnowledgeStore {
  let store = createDefaultKnowledgeStore()
  for (const title of titles) {
    store = createKnowledgePage(store, { spaceId: store.activeSpaceId, parentId: store.spaces[0]!.rootPageId, kind: 'wiki', title, body: `${title} body` })
  }
  for (const page of store.pages) io.files.set(`${PACKAGE}/pages/${pageFileName(page)}`, serializePageFile(page))
  io.files.set(`${PACKAGE}/index.json`, serializeKnowledgeIndex(store))
  io.files.set(`${PACKAGE}/activity.json`, serializeKnowledgeActivity(store.activity))
  io.files.set(`${PACKAGE}/proposals.json`, serializeKnowledgeProposals(store.agentChanges ?? []))
  return store
}

const onDisk = (): KnowledgePage[] =>
  [...io.files.entries()]
    .filter(([path]) => path.startsWith(`${PACKAGE}/pages/`))
    .map(([, text]) => parsePageFile(text)!)
const pageOnDisk = (title: string): KnowledgePage | undefined => onDisk().find(page => page.title === title)
const pageIn = (workspace: Workspace, title: string): KnowledgePage | undefined =>
  workspace.store!.pages.find(page => page.title === title)
const later = (ms: number) => new Date(Date.now() + ms).toISOString()
/** A copy's own edit, stamped `ms` from now: lets a test say which edit is the newer without waiting. */
function edit(pageId: string, body: string, ms = 0) {
  return (current: KnowledgeStore): KnowledgeStore => {
    const next = updateKnowledgePage(current, pageId, { body })
    return { ...next, pages: next.pages.map(page => (page.id === pageId ? { ...page, updatedAt: later(ms) } : page)) }
  }
}
const add = (title: string, body: string) => (current: KnowledgeStore): KnowledgeStore =>
  createKnowledgePage(current, { spaceId: current.activeSpaceId, parentId: current.spaces[0]!.rootPageId, kind: 'wiki', title, body })

beforeEach(() => {
  io.files.clear()
  io.storage.clear()
  io.listeners.clear()
  io.events = false
  io.settings = []
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterEach(async () => {
  await act(async () => { for (const root of roots.splice(0)) root.unmount() })
  vi.clearAllMocks()
})

describe('two copies, different pages', () => {
  it('both add a page: both pages and both activity lines survive', async () => {
    seed()
    const a = await open()
    const b = await open(true)
    await act(async () => {
      await a.current().saveStore(add('From A', 'a'))
      await b.current().saveStore(add('From B', 'b'))
    })
    expect(pageOnDisk('From A')?.body).toBe('a')
    expect(pageOnDisk('From B')?.body).toBe('b')
    const activity = JSON.parse(io.files.get(`${PACKAGE}/activity.json`)!) as Array<{ text: string }>
    expect(activity.map(item => item.text)).toEqual(expect.arrayContaining(['Created wiki page From A', 'Created wiki page From B']))
  })

  it('both edit a different page: both edits survive', async () => {
    const store = seed()
    const shared = store.pages.find(page => page.title === 'Shared')!
    const other = store.pages.find(page => page.title === 'Other')!
    const a = await open()
    const b = await open(true)
    await act(async () => {
      await a.current().saveStore(edit(shared.id, 'edited by A'))
      await b.current().saveStore(edit(other.id, 'edited by B'))
    })
    expect(pageOnDisk('Shared')?.body).toBe('edited by A')
    expect(pageOnDisk('Other')?.body).toBe('edited by B')
  })

  it('a page one copy deleted is not brought back when the other, not knowing, saves another page', async () => {
    const store = seed()
    const doomed = store.pages.find(page => page.title === 'Shared')!
    const other = store.pages.find(page => page.title === 'Other')!
    const a = await open()
    const b = await open(true)
    await act(async () => {
      await a.current().saveStore(current => deleteKnowledgePage(current, doomed.id))
      await b.current().saveStore(edit(other.id, 'edited by B'))
    })
    expect(pageOnDisk('Shared')).toBeUndefined()
    expect(pageOnDisk('Other')?.body).toBe('edited by B')
  })

  it('a page one copy deleted is not brought back by the other editing it, and the words it had typed are kept', async () => {
    const store = seed()
    const doomed = store.pages.find(page => page.title === 'Shared')!
    const a = await open()
    const b = await open(true)
    await act(async () => { await a.current().saveStore(current => deleteKnowledgePage(current, doomed.id)) })
    await act(async () => { await b.current().saveStore(edit(doomed.id, 'words typed in B', 1000)) })
    expect(pageOnDisk('Shared')).toBeUndefined()
    expect(onDisk().filter(page => page.id === doomed.id)).toEqual([])
    expect(onDisk().some(page => page.body === 'words typed in B')).toBe(true)
    await settle(() => b.current().externalNotice !== null)
    expect(b.current().externalNotice).toMatch(/deleted in another window/)
    expect(pageIn(b.current(), 'Shared')).toBeUndefined()
  })

  it('a page deleted after an edit the deleting copy never saw: deleted, and the words are kept', async () => {
    const store = seed()
    const doomed = store.pages.find(page => page.title === 'Shared')!
    const a = await open()
    const b = await open(true)
    await act(async () => { await a.current().saveStore(edit(doomed.id, 'words A saved', 0)) })
    await act(async () => { await b.current().saveStore(current => deleteKnowledgePage(current, doomed.id)) })
    expect(pageOnDisk('Shared')).toBeUndefined()
    expect(onDisk().some(page => page.body === 'words A saved')).toBe(true)
  })
})

describe('two copies, the same page', () => {
  it('both edit it: the newer stays on the page and the older words are kept, with a notice', async () => {
    const store = seed()
    const shared = store.pages.find(page => page.title === 'Shared')!
    const a = await open()
    const b = await open(true)
    await act(async () => { await a.current().saveStore(edit(shared.id, 'older words from A', 0)) })
    await act(async () => { await b.current().saveStore(edit(shared.id, 'newer words from B', 1000)) })
    expect(pageOnDisk('Shared')?.body).toBe('newer words from B')
    expect(onDisk().some(page => page.body === 'older words from A')).toBe(true)
    expect(b.current().externalNotice).toMatch(/another window/)
  })

  it('the older save arriving last does not replace the newer on the page', async () => {
    const store = seed()
    const shared = store.pages.find(page => page.title === 'Shared')!
    const a = await open()
    const b = await open(true)
    await act(async () => { await a.current().saveStore(edit(shared.id, 'newer words from A', 5000)) })
    await act(async () => { await b.current().saveStore(edit(shared.id, 'older words from B', 0)) })
    expect(pageOnDisk('Shared')?.body).toBe('newer words from A')
    expect(onDisk().some(page => page.body === 'older words from B')).toBe(true)
    expect(pageIn(b.current(), 'Shared')?.body).toBe('newer words from A')
  })

  it('a rename in one copy and an edit in the other leave one page, not two files for it', async () => {
    const store = seed()
    const shared = store.pages.find(page => page.title === 'Shared')!
    const a = await open()
    const b = await open(true)
    await act(async () => { await a.current().saveStore(current => updateKnowledgePage(current, shared.id, { title: 'Renamed' })) })
    await act(async () => { await b.current().saveStore(edit(shared.id, 'edited by B', 1000)) })
    expect(onDisk().filter(page => page.id === shared.id)).toHaveLength(1)
  })
})

describe('an older snapshot', () => {
  it('opening, then saving at once with a view older than the file, loses nothing', async () => {
    const store = seed()
    const other = store.pages.find(page => page.title === 'Other')!
    const a = await open()
    const stale = await open(true)
    await act(async () => {
      await a.current().saveStore(current => createKnowledgeSpace(current, { name: 'Second space' }))
      await a.current().saveStore(add('Added by A', 'a'))
      await a.current().saveStore(edit(other.id, 'edited by A'))
    })
    await act(async () => { await stale.current().saveStore(add('Added by stale', 's')) })
    const index = JSON.parse(io.files.get(`${PACKAGE}/index.json`)!) as { spaces: Array<{ name: string }> }
    expect(index.spaces.map(space => space.name)).toContain('Second space')
    expect(pageOnDisk('Other')?.body).toBe('edited by A')
    expect(pageOnDisk('Added by A')?.body).toBe('a')
    expect(pageOnDisk('Added by stale')?.body).toBe('s')
  })

  it('a save of a whole store older than what the copy already knows writes nothing back', async () => {
    const store = seed()
    const other = store.pages.find(page => page.title === 'Other')!
    const a = await open()
    const b = await open()
    const snapshot = b.current().store!
    await act(async () => { await a.current().saveStore(edit(other.id, 'edited by A', 1000)) })
    io.events = true
    await act(async () => { for (const listener of io.listeners) listener({ kind: 'content', path: `${PACKAGE}/pages/x.md` }) })
    await settle(() => pageIn(b.current(), 'Other')?.body === 'edited by A')
    await act(async () => { await b.current().saveStore(snapshot) })
    expect(pageOnDisk('Other')?.body).toBe('edited by A')
  })

  it('navigating in a stale normal copy does not take away a space the other added', async () => {
    const store = seed()
    const a = await open()
    const b = await open()
    await act(async () => { await a.current().saveStore(current => createKnowledgeSpace(current, { name: 'Second space' })) })
    await act(async () => { await b.current().saveStore(current => ({ ...current, activePageId: store.pages[1]!.id })) })
    const index = JSON.parse(io.files.get(`${PACKAGE}/index.json`)!) as { spaces: Array<{ name: string }> }
    expect(index.spaces.map(space => space.name)).toContain('Second space')
  })
})

describe('simultaneous saves', () => {
  it('side files read at the same moment by both copies keep both changes', async () => {
    seed()
    const a = await open()
    const b = await open(true)
    await act(async () => {
      await Promise.all([
        a.current().saveStore(add('From A', 'a')),
        b.current().saveStore(add('From B', 'b')),
      ])
    })
    const activity = JSON.parse(io.files.get(`${PACKAGE}/activity.json`)!) as Array<{ text: string }>
    expect(activity.map(item => item.text)).toEqual(expect.arrayContaining(['Created wiki page From A', 'Created wiki page From B']))
  })

  it('the same page saved at the same moment by both copies keeps both sets of words', async () => {
    const store = seed()
    const shared = store.pages.find(page => page.title === 'Shared')!
    const a = await open()
    const b = await open(true)
    await act(async () => {
      await Promise.all([
        a.current().saveStore(edit(shared.id, 'words from A', 0)),
        b.current().saveStore(edit(shared.id, 'words from B', 1)),
      ])
    })
    const bodies = onDisk().map(page => page.body)
    expect(bodies).toContain('words from A')
    expect(bodies).toContain('words from B')
  })

  it('two first opens of a new package make one store, not two', async () => {
    const first = mount(false)
    const second = mount(true)
    await act(async () => {
      first.start()
      second.start()
    })
    await settle(() => Boolean(first.current()?.store && second.current()?.store))
    expect(onDisk().filter(page => page.title === '_index')).toHaveLength(1)
    expect(first.current().store!.spaces[0]!.id).toBe(second.current().store!.spaces[0]!.id)
  })
})

describe('proposals and history', () => {
  const propose = (current: KnowledgeStore) => proposeKnowledgeAgentChange(current, {
    spaceId: current.activeSpaceId,
    agentName: 'Agent',
    changeType: 'page.create',
    title: 'Proposed page',
    summary: 'why',
    patch: { title: 'Proposed page', body: 'text' },
  })

  it('a proposal one copy accepted is not reopened by the other, and one it made is not lost', async () => {
    let store = seed()
    store = propose(store)
    io.files.set(`${PACKAGE}/proposals.json`, serializeKnowledgeProposals(store.agentChanges ?? []))
    const changeId = store.agentChanges![0]!.id
    const a = await open()
    const b = await open(true)
    await act(async () => { await a.current().saveStore(current => acceptKnowledgeAgentChange(current, changeId)) })
    await act(async () => { await b.current().saveStore(current => propose(current)) })
    const proposals = JSON.parse(io.files.get(`${PACKAGE}/proposals.json`)!) as Array<{ id: string; status: string }>
    expect(proposals.find(change => change.id === changeId)?.status).toBe('accepted')
    expect(proposals.filter(change => change.status === 'pending')).toHaveLength(1)
  })
})

describe('picking up what the other copy did', () => {
  it('a normal copy takes it from the shell’s change event', async () => {
    seed()
    io.events = true
    const a = await open()
    const b = await open()
    await act(async () => { await a.current().saveStore(add('From A', 'a')) })
    await settle(() => Boolean(pageIn(b.current(), 'From A')))
    expect(pageIn(b.current(), 'From A')?.body).toBe('a')
  })

  it('a copy held in a room, which the shell tells nothing, takes it by looking on focus', async () => {
    seed()
    const a = await open()
    const held = await open(true)
    await act(async () => { await a.current().saveStore(add('From A', 'a')) })
    await act(async () => { window.dispatchEvent(new Event('focus')) })
    await settle(() => Boolean(pageIn(held.current(), 'From A')))
    expect(pageIn(held.current(), 'From A')?.body).toBe('a')
  })

  it('a deletion reaches the other copy, and its next save does not write the page back', async () => {
    const store = seed()
    const doomed = store.pages.find(page => page.title === 'Shared')!
    const other = store.pages.find(page => page.title === 'Other')!
    io.events = true
    const a = await open()
    const b = await open()
    await act(async () => { await a.current().saveStore(current => deleteKnowledgePage(current, doomed.id)) })
    await settle(() => !pageIn(b.current(), 'Shared'))
    expect(pageIn(b.current(), 'Shared')).toBeUndefined()
    await act(async () => { await b.current().saveStore(edit(other.id, 'edited by B')) })
    expect(pageOnDisk('Shared')).toBeUndefined()
  })

  it('a look that finds nothing new says nothing and changes nothing', async () => {
    seed()
    await open()
    const held = await open(true)
    const before = held.current().store
    await act(async () => { window.dispatchEvent(new Event('focus')) })
    await settle(() => false, 60)
    expect(held.current().store).toBe(before)
    expect(held.current().externalNotice).toBeNull()
  })
})

describe('a held copy starts no shared work of its own', () => {
  it('does not change the app’s settings when it opens or saves', async () => {
    const store = seed()
    await open(true).then(async held => {
      await act(async () => { await held.current().saveStore(edit(store.pages[1]!.id, 'edited')) })
      await act(async () => { await held.current().saveStore(current => ({ ...current, activePageId: store.pages[2]!.id })) })
    })
    expect(io.settings).toEqual([])
  })

  it('does not move the shared last-open page when a person looks around in it', async () => {
    const store = seed()
    const before = io.files.get(`${PACKAGE}/index.json`)
    const held = await open(true)
    await act(async () => { await held.current().saveStore(current => ({ ...current, activePageId: store.pages[2]!.id })) })
    expect(io.files.get(`${PACKAGE}/index.json`)).toBe(before)
  })

  it('a normal copy still records where the person is', async () => {
    const store = seed()
    const tab = await open()
    await act(async () => { await tab.current().saveStore(current => ({ ...current, activePageId: store.pages[2]!.id })) })
    expect(JSON.parse(io.files.get(`${PACKAGE}/index.json`)!).activePageId).toBe(store.pages[2]!.id)
    expect(io.settings.length).toBeGreaterThan(0)
  })

  it('does not import a plain file it was opened on', async () => {
    seed()
    io.files.set('/desk/notes.md', 'imported text')
    let latest!: Workspace
    const handled = vi.fn()
    const boot = bootFor(true)
    function Harness() {
      latest = useKnowledgeWorkspace(boot, '/desk/notes.md', handled)
      return null
    }
    const root = createRoot(document.createElement('div'))
    roots.push(root)
    await act(async () => { root.render(<Harness />) })
    await settle(() => Boolean(latest.store))
    await settle(() => false, 60)
    expect(pageOnDisk('notes')).toBeUndefined()
    expect(handled).toHaveBeenCalled()
  })
})
