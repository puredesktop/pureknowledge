// @vitest-environment happy-dom
/**
 * The page editor when another copy saves the page it has open. Two whole KnowledgeWorkspaces with their real store over
 * one fake filesystem: the only things not real are the rich editor and the file bridge.
 */
import { act, forwardRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { DocumentEditorHandle } from '@purescience/platform-editor'

const io = vi.hoisted(() => ({
  files: new Map<string, string>(),
  storage: new Map<string, { value: unknown; version: string }>(),
  listeners: new Set<(change: { kind: string; path: string }) => void>(),
  events: true,
}))
vi.mock('./bridge/platformBridge', async importOriginal => ({
  ...await importOriginal<typeof import('./bridge/platformBridge')>(),
  readTextFile: vi.fn(async (path: string) => {
    const value = io.files.get(path)
    if (value === undefined) throw new Error(`ENOENT ${path}`)
    return value
  }),
  writeTextFile: vi.fn(async (path: string, value: string) => {
    io.files.set(path, value)
    if (io.events) for (const listener of io.listeners) listener({ kind: 'content', path })
  }),
  updateKnowledgeSettings: vi.fn(async () => ({})),
  recordOperation: vi.fn(async () => undefined),
}))
vi.mock('@purescience/platform-ui/bridge/fs', () => ({
  readPlatformFilePreviewUrl: vi.fn(async () => ({ url: 'purescience-fs://asset/test' })),
  readPlatformFileBinary: vi.fn(),
  renamePlatformFile: vi.fn(async () => undefined),
  listPlatformFiles: vi.fn(async (path: string) => ({
    entries: [...io.files.keys()]
      .filter(file => file.startsWith(`${path}/`) && !file.slice(path.length + 1).includes('/'))
      .map(file => ({ name: file.split('/').pop()!, path: file, isDirectory: false })),
  })),
  deletePlatformFile: vi.fn(async (path: string) => { io.files.delete(path) }),
}))
vi.mock('@purescience/platform-ui/bridge/documents', () => ({
  registerPlatformAppObject: vi.fn(async () => undefined),
  onPlatformDocumentsChanged: vi.fn((listener: (change: { kind: string; path: string }) => void) => {
    io.listeners.add(listener)
    return () => io.listeners.delete(listener)
  }),
}))
vi.mock('@purescience/platform-ui/bridge/storage', () => ({
  readPlatformStorageJson: vi.fn(async ({ fileName }: { fileName: string }) => {
    const held = io.storage.get(fileName)
    return { path: `/.appdata/${fileName}`, value: held?.value ?? null, version: held?.version ?? null }
  }),
  writePlatformStorageJson: vi.fn(async ({ fileName, value, ifMatch }: { fileName: string; value: unknown; ifMatch?: string | null }) => {
    const held = io.storage.get(fileName)
    if (ifMatch !== undefined && (held?.version ?? null) !== ifMatch) return { path: '', ok: false, conflict: true, version: held?.version ?? null }
    const version = String(Math.random())
    io.storage.set(fileName, { value, version })
    return { path: '', ok: true, version }
  }),
}))
vi.mock('./hooks/useKnowledgeMeaning', () => ({
  useKnowledgeMeaning: () => ({
    state: { state: 'checking' },
    setUp: vi.fn(),
    retry: vi.fn(),
    vector: async () => null,
    readiness: () => ({ state: 'checking' }),
    index: () => null,
  }),
}))
vi.mock('./hooks/useKnowledgeAgentTools', () => ({ useKnowledgeAgentTools: vi.fn() }))
vi.mock('./hooks/useKnowledgeDrop', () => ({ useKnowledgeDrop: () => '' }))
vi.mock('./lib/knowledgeDrop', () => ({ embedKnowledgeVideos: (html: string) => html }))
vi.mock('./bridge/knowledgeAssets', () => ({ saveKnowledgeImage: vi.fn() }))
vi.mock('@purescience/platform-ui/components/common/containers/AppChrome', () => {
  const component = forwardRef((props: any, ref: any) => {
    const Element = props.as || 'div'
    const { as: _as, ...rest } = props
    return <Element ref={ref} {...rest} />
  })
  return { AppSidebar: component, EditorToolbar: component, MetaText: component, ReadingSurface: component, SidebarSectionLabel: component, ToolbarSelect: component }
})
vi.mock('@purescience/platform-ui/editor', () => ({
  useEditorExtensions: () => [],
  DocumentEditor: forwardRef<DocumentEditorHandle, { onChange: (html: string) => void; value: string }>(
    function MockDocumentEditor({ onChange, value }, _ref) {
      return (
        <div>
          <div className="mock-editor">{value}</div>
          <button type="button" onClick={() => onChange('<p>Typed here</p>')}>Write body</button>
        </div>
      )
    },
  ),
}))

import { KnowledgeWorkspace } from './App'
import { createDefaultKnowledgeStore, createKnowledgePage } from './lib/knowledgeStore'
import {
  pageFileName,
  parsePageFile,
  serializeKnowledgeActivity,
  serializeKnowledgeIndex,
  serializeKnowledgeProposals,
  serializePageFile,
} from './lib/knowledgePages'
import type { KnowledgePage } from './lib/knowledgeTypes'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const PACKAGE = '/desk/wiki.knowledge'
const roots: Root[] = []
const boot = { prefs: { workingDirectory: '/desk', theme: 'light' }, appSettings: { storePath: PACKAGE } } as never

function seed(): KnowledgePage {
  let store = createDefaultKnowledgeStore()
  store = createKnowledgePage(store, { spaceId: store.activeSpaceId, parentId: store.spaces[0]!.rootPageId, kind: 'wiki', title: 'Shared', body: 'First words' })
  for (const page of store.pages) io.files.set(`${PACKAGE}/pages/${pageFileName(page)}`, serializePageFile(page))
  io.files.set(`${PACKAGE}/index.json`, serializeKnowledgeIndex(store))
  io.files.set(`${PACKAGE}/activity.json`, serializeKnowledgeActivity(store.activity))
  io.files.set(`${PACKAGE}/proposals.json`, serializeKnowledgeProposals([]))
  return store.pages.find(page => page.title === 'Shared')!
}

/** Small act windows: React only renders when one closes, and the editor's timers must see those renders, as in the app. */
async function wait(ms: number): Promise<void> {
  const until = Date.now() + ms
  while (Date.now() < until) await act(async () => { await new Promise(resolve => setTimeout(resolve, 15)) })
}
async function openCopy(): Promise<HTMLDivElement> {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => {
    root.render(<KnowledgeWorkspace boot={boot} resourcePath={null} onResourceHandled={() => undefined} compact={false} />)
  })
  await wait(40)
  return container
}
function button(container: HTMLElement, text: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll('button')).find(item => item.textContent?.includes(text))
  if (!found) throw new Error(`Missing button: ${text}`)
  return found
}
const click = async (container: HTMLElement, text: string) => { await act(async () => { button(container, text).click() }) }
const pages = (): KnowledgePage[] =>
  [...io.files.entries()].filter(([path]) => path.startsWith(`${PACKAGE}/pages/`)).map(([, text]) => parsePageFile(text)!)
const shared = (id: string) => pages().find(page => page.id === id)!

/** The other copy's save, already on disk and announced: what the open copy sees when another copy saves. */
async function otherCopySaves(page: KnowledgePage, body: string): Promise<void> {
  const current = shared(page.id)
  const next = { ...current, body, updatedAt: new Date().toISOString() }
  await act(async () => {
    io.files.set(`${PACKAGE}/pages/${pageFileName(next)}`, serializePageFile(next))
    if (io.events) for (const listener of io.listeners) listener({ kind: 'content', path: `${PACKAGE}/pages/${pageFileName(next)}` })
  })
}

beforeEach(() => {
  io.files.clear()
  io.storage.clear()
  io.listeners.clear()
  io.events = true
  const portal = document.createElement('div')
  portal.id = 'platform-menu-portal'
  document.body.append(portal)
})
afterEach(async () => {
  await act(async () => { for (const root of roots.splice(0)) root.unmount() })
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

it('an open editor with nothing typed does not write its old words over what the other copy saved', async () => {
  const page = seed()
  const copy = await openCopy()
  await click(copy, 'Edit page')
  await otherCopySaves(page, 'Words the other copy saved')
  await wait(1300) // past the change event's 400ms and the autosave's 700ms
  expect(shared(page.id).body).toBe('Words the other copy saved')
  expect(copy.querySelector('.mock-editor')?.textContent).toContain('Words the other copy saved')
})

it('Done on an untouched editor does not put the old words back', async () => {
  const page = seed()
  const copy = await openCopy()
  await click(copy, 'Edit page')
  await otherCopySaves(page, 'Words the other copy saved')
  await wait(500)
  await click(copy, 'Done')
  await wait(100)
  expect(shared(page.id).body).toBe('Words the other copy saved')
})

it('words being typed when the other copy saves: both survive, and the person is told', async () => {
  const page = seed()
  const copy = await openCopy()
  await click(copy, 'Edit page')
  await click(copy, 'Write body')
  await otherCopySaves(page, 'Words the other copy saved')
  await wait(1300)
  const bodies = pages().map(item => item.body)
  expect(bodies.some(body => body.includes('Typed here'))).toBe(true)
  expect(bodies).toContain('Words the other copy saved')
  expect(copy.textContent).toMatch(/another window/)
})

it('with no change event at all, as in a room: typing over a save never seen keeps both', async () => {
  const page = seed()
  io.events = false
  const copy = await openCopy()
  await click(copy, 'Edit page')
  await otherCopySaves(page, 'Words the other copy saved')
  await click(copy, 'Write body')
  await wait(900)
  const bodies = pages().map(item => item.body)
  expect(bodies.some(body => body.includes('Typed here'))).toBe(true)
  expect(bodies).toContain('Words the other copy saved')
  expect(copy.textContent).toMatch(/another window/)
})

it('words being typed when the other copy deletes the page: it stays deleted, and the words are kept and said so', async () => {
  const page = seed()
  const copy = await openCopy()
  await click(copy, 'Edit page')
  await click(copy, 'Write body')
  await act(async () => {
    io.files.delete(`${PACKAGE}/pages/${pageFileName(page)}`)
    for (const listener of io.listeners) listener({ kind: 'content', path: `${PACKAGE}/pages/${pageFileName(page)}` })
  })
  await wait(600)
  expect(shared(page.id)).toBeUndefined()
  expect(pages().some(item => item.body.includes('Typed here'))).toBe(true)
  expect(copy.textContent).toMatch(/deleted in another window/)
})

it('its own autosave coming back is not taken for another copy', async () => {
  const page = seed()
  const copy = await openCopy()
  await click(copy, 'Edit page')
  await click(copy, 'Write body')
  await wait(900)
  expect(shared(page.id).body).toContain('Typed here')
  expect(pages().filter(item => item.tags.includes('kept-copy'))).toEqual([])
  expect(copy.textContent).not.toMatch(/another window/)
})

it('an edit made by this copy keeps working with no other copy about', async () => {
  const page = seed()
  const copy = await openCopy()
  await click(copy, 'Edit page')
  await click(copy, 'Write body')
  await click(copy, 'Done')
  await wait(100)
  expect(shared(page.id).body).toContain('Typed here')
})
