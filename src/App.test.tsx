// @vitest-environment happy-dom
import { act } from 'react'
import { forwardRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DocumentEditorHandle } from '@purescience/platform-editor'

const platformFs = vi.hoisted(() => ({ preview: vi.fn() }))

vi.mock('@purescience/platform-ui/bridge/fs', () => ({
  readPlatformFilePreviewUrl: platformFs.preview,
  readPlatformFileBinary: vi.fn(),
}))
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
      return (
        <button type="button" onClick={() => onChange('<p>Unsaved body</p>')}>
          Write body
        </button>
      )
    },
  ),
}))

import { KnowledgePageEditor } from './App'
import { saveKnowledgeImage } from './bridge/knowledgeAssets'
import { recordOperation } from './bridge/platformBridge'
import { createDefaultKnowledgeStore, createKnowledgePage } from './lib/knowledgeStore'
import type { KnowledgePage, KnowledgeStore } from './lib/knowledgeTypes'

const roots = new Set<Root>()
let root: Root
let container: HTMLDivElement

function deferred() {
  let resolve!: (value: { url: string }) => void
  const wait = new Promise<{ url: string }>(done => { resolve = done })
  return { wait, resolve }
}

function button(text: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll('button')).find(
    candidate => candidate.textContent?.includes(text),
  )
  if (!found) throw new Error(`Missing button: ${text}`)
  return found as HTMLButtonElement
}

async function renderEditor(
  store: KnowledgeStore,
  page: KnowledgePage | null,
  onSave: (update: KnowledgeStore | ((current: KnowledgeStore) => KnowledgeStore)) => void,
  editRequest: { pageId: string; nonce: number } | null = null,
) {
  await act(async () => {
    root.render(
      <KnowledgePageEditor
        packagePath="/audit/knowledge.knowledge"
        store={store}
        activeSpace={store.spaces[0]!}
        page={page}
        saving={false}
        onSelectPage={() => undefined}
        onSave={onSave}
        editRequest={editRequest}
      />,
    )
  })
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  roots.add(root)
  platformFs.preview.mockResolvedValue({ url: 'purescience-fs://asset/test' })
})

afterEach(async () => {
  await act(async () => {
    for (const mounted of roots) mounted.unmount()
  })
  roots.clear()
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

describe('KnowledgePageEditor editing reliability', () => {
  it('flushes a pending body edit when navigation replaces the page', async () => {
    let store = createDefaultKnowledgeStore()
    const first = store.pages[0]!
    store = createKnowledgePage(store, {
      spaceId: store.activeSpaceId,
      parentId: first.id,
      kind: 'wiki',
      title: 'Second',
    })
    const second = store.pages[0]!
    let saved = store
    const onSave = vi.fn((update: KnowledgeStore | ((current: KnowledgeStore) => KnowledgeStore)) => {
      saved = typeof update === 'function' ? update(saved) : update
    })
    await renderEditor(store, first, onSave)
    await act(async () => { button('Edit page').click() })
    await act(async () => { button('Write body').click() })
    expect(onSave).not.toHaveBeenCalled()

    await renderEditor(store, second, onSave)

    expect(onSave).toHaveBeenCalled()
    expect(saved.pages.find(page => page.id === first.id)?.body).toBe('Unsaved body')
    expect(recordOperation).toHaveBeenCalledWith(expect.objectContaining({
      lane: 'user',
      kind: 'page.update',
      summary: `Edited page "${first.title}"`,
    }))
  })

  it('flushes an unblurred title and tags when navigation replaces the page', async () => {
    let store = createDefaultKnowledgeStore()
    const first = store.pages[0]!
    store = createKnowledgePage(store, {
      spaceId: store.activeSpaceId,
      parentId: first.id,
      kind: 'wiki',
      title: 'Second',
    })
    const second = store.pages[0]!
    let saved = store
    const onSave = vi.fn((update: KnowledgeStore | ((current: KnowledgeStore) => KnowledgeStore)) => {
      saved = typeof update === 'function' ? update(saved) : update
    })
    await renderEditor(store, first, onSave)
    await act(async () => { button('Edit page').click() })
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    const title = container.querySelector<HTMLInputElement>('input[aria-label="Page title"]')!
    setValue.call(title, 'Renamed without blur')
    await act(async () => { title.dispatchEvent(new Event('input', { bubbles: true })) })
    const tags = container.querySelector<HTMLInputElement>('#page-tags')!
    setValue.call(tags, 'alpha, beta')
    await act(async () => { tags.dispatchEvent(new Event('input', { bubbles: true })) })

    await renderEditor(store, second, onSave)

    expect(saved.pages.find(page => page.id === first.id)?.title).toBe('Renamed without blur')
    expect(saved.pages.find(page => page.id === first.id)?.tags).toEqual(['alpha', 'beta'])
  })

  it('does not reopen a consumed tree edit request on a later ordinary visit', async () => {
    let store = createDefaultKnowledgeStore()
    const first = store.pages[0]!
    store = createKnowledgePage(store, {
      spaceId: store.activeSpaceId,
      parentId: first.id,
      kind: 'wiki',
      title: 'Second',
    })
    const second = store.pages[0]!
    const request = { pageId: first.id, nonce: 1 }
    await renderEditor(store, first, () => undefined, request)
    expect(button('Done')).toBeTruthy()
    await act(async () => { button('Done').click() })
    await renderEditor(store, second, () => undefined, request)
    await renderEditor(store, first, () => undefined, request)
    expect(button('Edit page')).toBeTruthy()
  })

  it('keeps editing unavailable until page HTML preparation finishes', async () => {
    let store = createDefaultKnowledgeStore()
    store = createKnowledgePage(store, {
      spaceId: store.activeSpaceId,
      parentId: store.spaces[0]!.rootPageId,
      kind: 'wiki',
      title: 'Images',
      body: '![Diagram](assets/diagram.png)',
    })
    const gate = deferred()
    platformFs.preview.mockReturnValueOnce(gate.wait)
    await renderEditor(store, store.pages[0]!, () => undefined)
    expect(button('Edit page').disabled).toBe(true)
    await act(async () => { gate.resolve({ url: 'purescience-fs://asset/ready' }) })
    expect(button('Edit page').disabled).toBe(false)
  })

  it('does not let a slow gallery import overwrite edits on another page', async () => {
    let store = createDefaultKnowledgeStore()
    store = createKnowledgePage(store, {
      spaceId: store.activeSpaceId,
      parentId: store.spaces[0]!.rootPageId,
      kind: 'wiki',
      title: 'Gallery',
      body: ':::gallery\n![Existing](assets/existing.png)\n:::',
    })
    const gallery = store.pages[0]!
    store = createKnowledgePage(store, {
      spaceId: store.activeSpaceId,
      parentId: store.spaces[0]!.rootPageId,
      kind: 'wiki',
      title: 'Other page',
    })
    const other = store.pages[0]!
    let saved = store
    const onSave = vi.fn((update: KnowledgeStore | ((current: KnowledgeStore) => KnowledgeStore)) => {
      saved = typeof update === 'function' ? update(saved) : update
    })
    let resolveImage!: (image: { relativePath: string; absolutePath: string; dataUrl: string }) => void
    vi.mocked(saveKnowledgeImage).mockReturnValueOnce(new Promise(resolve => { resolveImage = resolve }))
    await renderEditor(store, gallery, onSave)
    const add = container.querySelector<HTMLButtonElement>('button[data-gallery-add]')!
    await act(async () => { add.click() })
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!
    const file = {
      name: 'new.png', size: 4, type: 'image/png',
      arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
    } as File
    Object.defineProperty(input, 'files', { configurable: true, value: [file] })
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })) })
    await vi.waitFor(() => expect(saveKnowledgeImage).toHaveBeenCalled())

    await renderEditor(saved, other, onSave)
    await act(async () => { button('Edit page').click() })
    await act(async () => { button('Write body').click() })
    await act(async () => { button('Done').click() })
    expect(saved.pages.find(page => page.id === other.id)?.body).toBe('Unsaved body')

    await act(async () => {
      resolveImage({ relativePath: 'assets/new.png', absolutePath: '/audit/knowledge.knowledge/assets/new.png', dataUrl: 'data:image/png;base64,YQ==' })
    })
    await vi.waitFor(() => expect(saved.pages.find(page => page.id === gallery.id)?.body).toContain('new.png'))
    expect(saved.pages.find(page => page.id === other.id)?.body).toBe('Unsaved body')
  })
})
