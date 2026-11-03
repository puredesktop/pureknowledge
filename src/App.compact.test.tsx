// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { act, forwardRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { DocumentEditorHandle } from '@purescience/platform-editor'

vi.mock('@purescience/platform-ui/bridge/fs', () => ({
  readPlatformFilePreviewUrl: vi.fn(async () => ({ url: 'purescience-fs://asset/test' })),
  readPlatformFileBinary: vi.fn(),
}))
vi.mock('./hooks/useKnowledgeWorkspace', () => ({ useKnowledgeWorkspace: vi.fn() }))
vi.mock('./hooks/useKnowledgeAgentTools', () => ({ useKnowledgeAgentTools: vi.fn() }))
vi.mock('./hooks/useKnowledgeDrop', () => ({ useKnowledgeDrop: () => '' }))
vi.mock('./lib/knowledgeDrop', () => ({ embedKnowledgeVideos: (html: string) => html }))
vi.mock('./bridge/knowledgeAssets', () => ({ saveKnowledgeImage: vi.fn() }))
vi.mock('./bridge/platformBridge', async importOriginal => ({
  ...await importOriginal<typeof import('./bridge/platformBridge')>(),
  recordOperation: vi.fn(async () => undefined),
}))
vi.mock('@purescience/platform-ui/components/common/containers/AppChrome', () => {
  const component = forwardRef((props: any, ref: any) => {
    const Element = props.as || 'div'
    const { as: _as, ...rest } = props
    return <Element ref={ref} {...rest} />
  })
  return {
    AppSidebar: component,
    EditorToolbar: component,
    MetaText: component,
    ReadingSurface: component,
    SidebarSectionLabel: component,
    ToolbarSelect: component,
  }
})
vi.mock('@purescience/platform-ui/editor', () => ({
  useEditorExtensions: () => [],
  DocumentEditor: forwardRef<DocumentEditorHandle, { onChange: (html: string) => void }>(
    function MockDocumentEditor({ onChange }, _ref) {
      return <button type="button" onClick={() => onChange('<p>Corrected body</p>')}>Write body</button>
    },
  ),
}))

import { KnowledgeWorkspace } from './App'
import { useKnowledgeAgentTools } from './hooks/useKnowledgeAgentTools'
import { useKnowledgeWorkspace } from './hooks/useKnowledgeWorkspace'
import { createDefaultKnowledgeStore, createKnowledgePage, updateKnowledgePage } from './lib/knowledgeStore'
import type { KnowledgeStore } from './lib/knowledgeTypes'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root, container: HTMLDivElement, store: KnowledgeStore, compact: boolean
let workspaceState: { saving: boolean; error: Error | null; saveFailed: boolean; externalNotice: string | null }
const saveStore = vi.fn(async (update: KnowledgeStore | ((current: KnowledgeStore) => KnowledgeStore)) => {
  store = typeof update === 'function' ? update(store) : update
  rerender()
})

function current() {
  vi.mocked(useKnowledgeWorkspace).mockReturnValue({ store, storePath: '/org.knowledge', loading: false, ...workspaceState, saveStore } as never)
  return <KnowledgeWorkspace boot={{ prefs: { workingDirectory: '/org', theme: 'light' }, appSettings: {} } as never} resourcePath={null} onResourceHandled={() => undefined} compact={compact} />
}
function rerender() { root.render(current()) }
async function render(next: boolean) { compact = next; await act(async () => rerender()) }

const view = () => container.querySelector('[data-compact-view]')?.getAttribute('data-compact-view')
const rowTitles = () => Array.from(container.querySelectorAll('.knowledge-compact-row-title')).map(row => row.textContent)
function button(text: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll('button')).find(item => item.textContent?.includes(text))
  if (!found) throw new Error(`Missing button: ${text}`)
  return found
}
const click = async (text: string) => { await act(async () => { button(text).click() }) }
const addPage = (title: string, body = '') => {
  store = createKnowledgePage(store, { spaceId: store.activeSpaceId, parentId: store.pages[store.pages.length - 1]!.id, kind: 'wiki', title, body })
}
async function type(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
  await act(async () => { input.dispatchEvent(new Event('input', { bubbles: true })) })
}

beforeEach(() => {
  store = createDefaultKnowledgeStore()
  workspaceState = { saving: false, error: null, saveFailed: false, externalNotice: null }
  container = document.createElement('div')
  const portal = document.createElement('div')
  portal.id = 'platform-menu-portal'
  document.body.append(container, portal)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

it('with compact off, nothing of compact reaches the page and the whole app is there', async () => {
  addPage('Travel policy', 'Book early.')
  await render(false)
  expect(container.innerHTML).not.toContain('data-compact')
  expect(container.innerHTML).not.toContain('knowledge-compact')
  expect(button('+ add page')).toBeDefined()
  expect(button('Edit page')).toBeDefined()
  expect(container.querySelector('nav[aria-label="Page path"], [aria-label="Page path"]')).not.toBeNull()
})

it('in compact, starts on the list, without the root index, and hides the chrome rather than removing it', async () => {
  addPage('Travel policy', 'Book early.')
  await render(true)
  expect(view()).toBe('list')
  expect(rowTitles()).toEqual(['Travel policy'])
  expect(container.querySelector('.knowledge-compact-row-text')?.textContent).toBe('Book early.')
  const header = container.querySelector('header')!
  expect(header.hasAttribute('data-compact-hide')).toBe(true)
  expect(button('+ add page').closest('[data-compact-hide]')).not.toBeNull()
  expect(useKnowledgeAgentTools).toHaveBeenCalled()
})

it('search narrows the list, and says so when nothing matches', async () => {
  addPage('Travel policy', 'Book early.')
  addPage('Hiring', 'Two interviews.')
  await render(true)
  const search = container.querySelector<HTMLInputElement>('.knowledge-compact-search input')!
  await type(search, 'interviews')
  expect(rowTitles()).toEqual(['Hiring'])
  await type(search, 'zebra')
  expect(rowTitles()).toEqual([])
  expect(container.querySelector('.knowledge-compact-quiet')?.textContent).toContain('zebra')
})

it('a row opens the page and All pages comes back to the list', async () => {
  addPage('Travel policy', 'Book early.')
  await render(true)
  await click('Travel policy')
  expect(view()).toBe('page')
  expect(container.querySelector('h1')?.textContent).toBe('Travel policy')
  await click('← All pages')
  expect(view()).toBe('list')
  expect(store.activePageId).toBe(store.pages[0]!.id)
})

it('going back while editing saves the edit the way Done does', async () => {
  addPage('Travel policy', 'Book early.')
  await render(true)
  await click('Travel policy')
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
  await click('Edit page')
  await click('Write body')
  await click('← All pages')
  expect(view()).toBe('list')
  expect(store.pages.find(page => page.title === 'Travel policy')?.body).toContain('Corrected body')
})

it('with nothing there, one quiet line and a way to start, which opens the new page', async () => {
  await render(true)
  expect(view()).toBe('list')
  expect(container.querySelector('.knowledge-compact-quiet')?.textContent).toBe('No pages here yet.')
  expect(container.querySelector('.knowledge-compact-search')).toBeNull()
  await click('New page')
  await type(container.querySelector<HTMLInputElement>('.knowledge-compact-start input')!, 'First page')
  await act(async () => {
    container.querySelector('.knowledge-compact-start form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
  expect(store.pages.some(page => page.title === 'First page')).toBe(true)
  expect(view()).toBe('page')
  expect(container.querySelector('h1')?.textContent).toBe('First page')
})

it('a save that failed is said, with Retry, though the header that says so is hidden', async () => {
  addPage('Travel policy')
  workspaceState = { ...workspaceState, error: new Error('Disk full'), saveFailed: true }
  await render(true)
  const notice = container.querySelector('.knowledge-compact-notice')!
  expect(notice.getAttribute('role')).toBe('alert')
  expect(notice.textContent).toContain('This change was not saved. Disk full')
  saveStore.mockClear()
  await click('Retry save')
  expect(saveStore).toHaveBeenCalled()
})

it('a policy says its edits stay a draft, since the publication panel is hidden', async () => {
  store = createKnowledgePage(store, { spaceId: store.activeSpaceId, parentId: store.pages[0]!.id, kind: 'wiki', title: 'Leave policy', body: 'Text', tags: ['policy'] })
  await render(true)
  await click('Leave policy')
  expect(container.querySelector('.knowledge-compact-note')?.textContent).toContain('Policy · draft. Edits stay a draft until published in the full app.')
  expect(container.querySelector('section[aria-label="Policy publication"]')).not.toBeNull()
})

it('retired guidance is marked on the row and keeps its note in the page', async () => {
  addPage('Old rule', 'Text')
  store = updateKnowledgePage(store, store.pages[0]!.id, { guidanceStatus: 'retired' })
  await render(true)
  expect(container.querySelector('.knowledge-compact-row-meta')?.textContent).toBe('Retired')
  await click('Old rule')
  expect(container.querySelector('section[aria-label="Page guidance"] [role="note"]')?.textContent).toContain('Retired guidance')
})

it('leaving and re-entering compact keeps the same page open and drops nothing', async () => {
  addPage('Travel policy', 'Book early.')
  await render(true)
  await click('Travel policy')
  await render(false)
  expect(container.querySelector('[data-compact-view]')).toBeNull()
  expect(container.querySelector('h1')?.textContent).toBe('Travel policy')
  await render(true)
  expect(view()).toBe('page')
})

it('every compact style starts from the attribute, except the white ground under a held frame', () => {
  const selectors = readFileSync('src/compact-in-room.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').match(/[^{}]+(?=\{)/g) ?? []
  expect(selectors.length).toBeGreaterThan(10)
  for (const group of selectors) {
    // Split on top-level commas only: the toolbar rule's commas sit inside :not().
    let depth = 0, part = ''
    for (const char of `${group},`) {
      if (char === '(') depth += 1
      if (char === ')') depth -= 1
      if (char === ',' && depth === 0) {
        const selector = part.trim()
        if (selector !== 'html[data-held-in-room]' && selector !== 'html[data-held-in-room] body') expect(selector).toContain('[data-compact-room]')
        part = ''
      } else part += char
    }
  }
})
