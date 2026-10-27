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
      return (
        <button type="button" onClick={() => onChange('<p>Unsaved body</p>')}>
          Write body
        </button>
      )
    },
  ),
}))

import { KnowledgePageEditor, KnowledgeWorkspace } from './App'
import { saveKnowledgeImage } from './bridge/knowledgeAssets'
import { recordOperation } from './bridge/platformBridge'
import { createDefaultKnowledgeStore, createKnowledgePage, createKnowledgeSpace, updateKnowledgePage } from './lib/knowledgeStore'
import { useKnowledgeWorkspace } from './hooks/useKnowledgeWorkspace'
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
  const portal = document.createElement('div')
  portal.id = 'platform-menu-portal'
  document.body.append(container, portal)
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
  it('validates manual links and adds them without overwriting newer page edits', async () => {
    const store = createDefaultKnowledgeStore()
    const page = store.pages[0]!
    let saved = store
    const onSave = vi.fn((update: KnowledgeStore | ((current: KnowledgeStore) => KnowledgeStore)) => {
      saved = typeof update === 'function' ? update(saved) : update
    })
    await renderEditor(store, page, onSave)
    await act(async () => { button('Edit page').click() })
    const title = container.querySelector<HTMLInputElement>('input[placeholder="Link title"]')!
    const target = container.querySelector<HTMLInputElement>('input[placeholder="Path or URL"]')!
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    const setInput = async (input: HTMLInputElement, value: string) => {
      setValue.call(input, value)
      await act(async () => { input.dispatchEvent(new Event('input', { bubbles: true })) })
    }
    const submit = async () => {
      await act(async () => {
        target.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      })
    }

    await setInput(title, 'Spec')
    for (const value of ['   ', 'HTTPS://exa mple.test']) {
      await setInput(target, value)
      expect(button('Link').disabled).toBe(true)
      await submit()
      expect(onSave).not.toHaveBeenCalled()
    }

    await setInput(target, ' HTTPS://Example.test/a ')
    expect(button('Link').disabled).toBe(false)
    // A write arrived after the editor rendered its store snapshot.
    saved = updateKnowledgePage(saved, page.id, { body: 'Newer page content' })
    await submit()

    const updated = saved.pages.find(candidate => candidate.id === page.id)!
    expect(updated.body).toBe('Newer page content')
    expect(updated.links).toHaveLength(page.links.length + 1)
    expect(updated.links).toContainEqual(expect.objectContaining({
      type: 'url', title: 'Spec', url: 'HTTPS://Example.test/a',
    }))
  })

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

describe('guidance controls and retained navigation', () => {
  it('records an explicit check and preserves it through status, replacement and content controls', async () => {
    let store = createDefaultKnowledgeStore()
    const id = store.pages[0]!.id
    store = createKnowledgePage(store, { spaceId: store.activeSpaceId, kind: 'wiki', title: 'Replacement guide', body: 'New instructions' })
    const targetId = store.activePageId!
    const save = (update: KnowledgeStore | ((current: KnowledgeStore) => KnowledgeStore)) => {
      store = typeof update === 'function' ? update(store) : update
    }
    const render = () => renderEditor(store, store.pages.find(page => page.id === id)!, save)
    const choose = async (trigger: string, option: string) => {
      await act(async () => { button(trigger).click() })
      const item = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(item => item.textContent?.trim() === option)
      expect(item, `menu item ${option}`).toBeTruthy()
      await act(async () => { item!.click() })
      await render()
    }
    await render()
    await act(async () => { container.querySelector('details')!.open = true })
    expect(container.textContent).toContain('Unmarked')
    await choose('Status: Unmarked', 'Draft')
    expect(store.pages.find(page => page.id === id)?.lastChecked).toBeUndefined()
    const date = container.querySelector<HTMLInputElement>('input[aria-label="Check date"]')!
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(date, '2026-10-01')
    await act(async () => { date.dispatchEvent(new Event('input', { bubbles: true })) })
    await act(async () => { date.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    await render()
    const checkedSnapshot = JSON.stringify(store)
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(date, '')
    await act(async () => { date.dispatchEvent(new Event('input', { bubbles: true })) })
    await act(async () => { date.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    expect(JSON.stringify(store)).toBe(checkedSnapshot)
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('valid ISO review date')
    const check = store.pages.find(page => page.id === id)!.lastChecked
    expect(check).toEqual({ actorType: 'human', actorName: 'You', at: '2026-10-01T00:00:00.000Z' })
    await choose('Status: Draft', 'Current')
    expect(container.textContent).toContain('recorded judgement')
    await choose('Status: Current', 'Retired')
    await choose('Replacement: None', `Replacement guide (${store.spaces[0]!.name})`)
    expect(store.pages.find(page => page.id === id)?.replacementPageId).toBe(targetId)
    await act(async () => { button('Edit page').click() })
    await act(async () => { button('Write body').click() })
    await act(async () => { button('Done').click() })
    await render()
    expect(store.pages.find(page => page.id === id)?.lastChecked).toEqual(check)
    expect(store.pages.find(page => page.id === id)?.body).toContain('Unsaved body')
    await choose('Status: Retired', 'Unmarked (ordinary note)')
    expect(store.pages.find(page => page.id === id)?.guidanceStatus).toBeUndefined()
    expect(store.pages.find(page => page.id === id)?.lastChecked).toEqual(check)
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(date, '2026-10-02')
    await act(async () => { date.dispatchEvent(new Event('input', { bubbles: true })) })
    await act(async () => { date.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    expect(store.pages.find(page => page.id === id)?.lastChecked).toEqual({ ...check, at: '2026-10-02T00:00:00.000Z' })
  })

  it('opens the original identity after retirement, follows exact replacement and shows unavailable saved targets', async () => {
    let store = createDefaultKnowledgeStore()
    const old = store.pages[0]!
    store = updateKnowledgePage(store, old.id, { body: 'Original retained instructions' })
    store = createKnowledgePage(store, { spaceId: store.activeSpaceId, kind: 'wiki', title: 'New guidance', body: 'Replacement instructions' })
    const replacement = store.activePageId!
    store = updateKnowledgePage(store, old.id, { guidanceStatus: 'retired', replacementPageId: replacement })
    store = createKnowledgePage(store, { spaceId: store.activeSpaceId, kind: 'wiki', title: 'Existing links', body: `Open \`${old.id}\` for the original guidance.` })
    const linksId = store.activePageId!
    const navigate = vi.fn()
    const render = async (id: string) => {
      await act(async () => {
        root.render(<KnowledgePageEditor packagePath="/audit/knowledge.knowledge" store={store} activeSpace={store.spaces[0]!} page={store.pages.find(page => page.id === id)!} saving={false} onSelectPage={navigate} onSave={() => undefined} editRequest={null} />)
      })
    }
    // Follow an existing rendered identity link after the target is retired.
    await render(linksId)
    const oldLink = container.querySelector<HTMLAnchorElement>(`a[data-knowledge-page="${old.id}"]`)!
    expect(oldLink).toBeTruthy()
    await act(async () => { oldLink.click() })
    expect(navigate).toHaveBeenCalledWith(old.id)
    navigate.mockClear()
    await render(old.id)
    expect(container.textContent).toContain('Original retained instructions')
    expect(container.textContent).toContain('Retired guidance')
    expect(navigate).not.toHaveBeenCalled()
    await act(async () => { button('Open replacement: New guidance').click() })
    expect(navigate).toHaveBeenCalledWith(replacement)
    await render(navigate.mock.calls[0]![0])
    expect(container.textContent).toContain('Replacement instructions')
    store = { ...store, pages: store.pages.filter(page => page.id !== replacement) }
    store = createKnowledgePage(store, { spaceId: store.activeSpaceId, kind: 'wiki', title: 'New guidance', body: 'Unrelated page with the same title' })
    await render(old.id)
    expect(container.textContent).toContain('Replacement unavailable in this notebook')
    expect(container.textContent).toContain('Original retained instructions')
    expect(container.textContent).not.toContain('Open replacement:')
  })
})


it('uses the actual sidebar search and filters, retaining retired page identity on selection', async () => {
  let store = createDefaultKnowledgeStore()
  const spaceId = store.activeSpaceId
  const ids: Record<string, string> = {}
  for (const status of ['unmarked', 'draft', 'current', 'retired'] as const) {
    store = createKnowledgePage(store, { spaceId, kind: 'note', title: `Sidebar ${status}`, body: 'Stored instructions' })
    ids[status] = store.activePageId!
    if (status !== 'unmarked') store = updateKnowledgePage(store, store.activePageId!, { guidanceStatus: status })
  }
  store = createKnowledgeSpace(store, { name: 'Other space' })
  store = createKnowledgePage(store, { spaceId: store.activeSpaceId, kind: 'wiki', title: 'Sidebar outside', body: 'Other' })
  store = { ...store, activeSpaceId: spaceId, activePageId: ids.current! }
  const saveStore = vi.fn(async (update: KnowledgeStore | ((current: KnowledgeStore) => KnowledgeStore)) => {
    store = typeof update === 'function' ? update(store) : update
  })
  const render = async () => {
    vi.mocked(useKnowledgeWorkspace).mockReturnValue({ store, storePath: '/fixture.knowledge', loading: false, saving: false, error: null, saveFailed: false, externalNotice: null, saveStore })
    await act(async () => { root.render(<KnowledgeWorkspace boot={{ prefs: { workingDirectory: '/fixture', theme: 'light' }, appSettings: {} }} resourcePath={null} onResourceHandled={() => undefined} />) })
  }
  await render()
  const input = container.querySelector<HTMLInputElement>('input[placeholder="Search knowledge"]')!
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Sidebar')
  await act(async () => { input.dispatchEvent(new Event('input', { bubbles: true })) })
  const resultButtons = () => Array.from(container.querySelectorAll<HTMLButtonElement>('button[data-agent-ref]'))
  expect(resultButtons().map(node => node.getAttribute('data-agent-label'))).toEqual(['Sidebar current', 'Sidebar draft', 'Sidebar unmarked', 'Sidebar retired'])
  for (const label of ['Retired', 'Draft', 'Current', 'Unmarked', 'All pages']) {
    await act(async () => { button('Status filter:').click() })
    const item = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(node => node.textContent?.trim() === label)!
    await act(async () => { item.click() })
    expect(resultButtons().map(node => node.getAttribute('data-agent-label'))).toEqual(label === 'All pages' ? ['Sidebar current', 'Sidebar draft', 'Sidebar unmarked', 'Sidebar retired'] : [`Sidebar ${label.toLowerCase()}`])
  }
  await act(async () => { resultButtons().find(node => node.getAttribute('data-agent-label') === 'Sidebar retired')!.click() })
  await render()
  expect(store.activePageId).toBe(ids.retired)
  expect(container.textContent).toContain('Retired guidance')
  expect(container.textContent).toContain('Stored instructions')
  // The explicit filter also retrieves retired pages without a text query.
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '')
  await act(async () => { input.dispatchEvent(new Event('input', { bubbles: true })) })
  await act(async () => { button('Status filter:').click() })
  const retired = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(node => node.textContent?.trim() === 'Retired')!
  await act(async () => { retired.click() })
  expect(resultButtons().map(node => node.getAttribute('data-agent-label'))).toEqual(['Sidebar retired'])
})

it('reports a stale replacement selection locally without a saved change or success ledger entry', async () => {
  let store = createDefaultKnowledgeStore()
  const original = store.pages[0]!
  store = createKnowledgePage(store, { spaceId: store.activeSpaceId, kind: 'wiki', title: 'Vanishing target' })
  const targetId = store.activePageId!
  let current = { ...store, pages: store.pages.filter(page => page.id !== targetId) }
  const snapshot = JSON.stringify(current)
  const save = (update: KnowledgeStore | ((current: KnowledgeStore) => KnowledgeStore)) => {
    // Like the workspace mutation adapter, a rejected update does not publish a store.
    try { current = typeof update === 'function' ? update(current) : update } catch { /* surfaced by guidance panel */ }
  }
  await renderEditor(store, original, save)
  vi.mocked(recordOperation).mockClear()
  await act(async () => { container.querySelector('details')!.open = true; button('Replacement: None').click() })
  const item = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(node => node.textContent?.includes('Vanishing target'))!
  await act(async () => { item.click() })
  expect(JSON.stringify(current)).toBe(snapshot)
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('existing accessible page')
  expect(recordOperation).not.toHaveBeenCalled()
})


it('disambiguates replacement pages with identical titles using stable identities', async () => {
  let store = createDefaultKnowledgeStore()
  const source = store.pages[0]!
  store = createKnowledgePage(store, { spaceId: store.activeSpaceId, kind: 'wiki', title: 'Same title' })
  const first = store.activePageId!
  store = createKnowledgePage(store, { spaceId: store.activeSpaceId, kind: 'wiki', title: 'Same title' })
  const second = store.activePageId!
  await renderEditor(store, source, update => { store = typeof update === 'function' ? update(store) : update })
  await act(async () => { container.querySelector('details')!.open = true; button('Replacement: None').click() })
  const items = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'))
  expect(items.find(node => node.textContent?.includes(first))).toBeTruthy()
  const chosen = items.find(node => node.textContent?.includes(second))!
  expect(chosen).toBeTruthy()
  await act(async () => { chosen.click() })
  expect(store.pages.find(page => page.id === source.id)?.replacementPageId).toBe(second)
})
