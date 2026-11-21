// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@purescience/platform-ui/bridge/fs', () => ({
  readPlatformFileBinary: vi.fn(),
  writePlatformFileBinary: vi.fn(async () => ({ ok: true })),
}))
vi.mock('@purescience/platform-ui/bridge/assets', () => ({
  updateCollectionAsset: vi.fn(async () => ({})),
}))
vi.mock('../bridge/platformBridge', async importOriginal => ({
  ...(await importOriginal<typeof import('../bridge/platformBridge')>()),
  recordOperation: vi.fn(async () => undefined),
}))

import {
  readPlatformFileBinary,
  writePlatformFileBinary,
} from '@purescience/platform-ui/bridge/fs'
import {
  importKnowledgeImages,
  saveKnowledgeImage,
} from '../bridge/knowledgeAssets'
import {
  applyKnowledgeChangeHandler,
  readKnowledgePageHandler,
  searchKnowledgeHandler,
} from '../agents/handlers'
import { PolicyPanel } from '../components/PolicyPanel'
import {
  prepareKnowledgeDocumentHtml,
  prepareKnowledgeDocumentHtmlWithUrls,
} from './knowledgeDocumentHtml'
import { mergeExternalKnowledgeStore } from './knowledgeExternal'
import {
  appendKnowledgeGalleryImages,
  knowledgeHtmlToMarkdown,
  knowledgeMarkdownToHtml,
} from './knowledgeGallery'
import { knowledgePagePassages } from './knowledgeMeaning'
import { parsePageFile, serializeKnowledgeIndex, serializePageFile } from './knowledgePages'
import {
  addKnowledgeLink,
  applyKnowledgeAgentChange,
  createDefaultKnowledgeStore,
  createKnowledgePage,
  createKnowledgeSpace,
  extractMarkdownHeadings,
  extractWikiLinks,
  proposeKnowledgeAgentChange,
  rankKnowledgePages,
  removeKnowledgeLink,
  renameKnowledgePageWithBacklinks,
  renameKnowledgeSpace,
  reviewKnowledgeStore,
  rewriteWikiLinksForRename,
  updateKnowledgePage,
} from './knowledgeStore'
import {
  parseOrganisationPage,
  queryOrganisationKnowledge,
  readOrganisationKnowledge,
} from './organisationKnowledge.mjs'
import {
  addHeadingAnchorsToHtml,
  hasDangerousSvgContent,
  isAbsolutePathInsidePackage,
  isSafeUrl,
  renderWikiLinksInHtml,
  resolveSafePackageRelativeAssetPath,
  sanitizeHtml,
} from './sanitizeHtml'
import { resolvePageSave } from './knowledgeSaveMerge'
import type { KnowledgePage, KnowledgeStore } from './knowledgeTypes'

afterEach(() => {
  vi.clearAllMocks()
})

describe('A.1 sanitizeHtml XSS vectors (DOM + Node fallback)', () => {
  const vectors = [
    '<p>Safe</p><script>alert(1)</script>',
    '<noscript><img src=x onerror=alert(1)></noscript>',
    '<template><script>alert(1)</script></template>',
    '<iframe src="https://evil.example/phish"></iframe>',
    '<object data="javascript:alert(1)"></object>',
    '<embed src="data:text/html,<script>alert(1)</script>">',
    '<meta http-equiv="refresh" content="0;url=javascript:alert(1)">',
    '<base href="https://evil.example/">',
    '<link rel="stylesheet" href="https://evil.example/a.css">',
    '<style>body{background:url(javascript:alert(1))}</style>',
    '<form action="https://evil.example"><input></form>',
    '<img src="https://example.com/a.png" onerror="alert(1)" ONLOAD="alert(2)">',
    '<a href="java\tscript:alert(1)">Click</a>',
    '<a href="&#106;avascript:alert(1)">Entity</a>',
    '<a href="vbscript:msgbox(1)">VBS</a>',
    '<a href="data:text/html,<script>alert(1)</script>">DataHTML</a>',
    '<img src="data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+PC9zdmc+">',
    '<svg><script>alert(1)</script><foreignObject><div>x</div></foreignObject><animate attributeName="href" values="javascript:alert(1)" /><set attributeName="onmouseover" to="alert(1)" /><circle cx="10" cy="10" r="5" /></svg>',
  ]

  it('strips all active XSS elements, attributes, SVG attacks, and obfuscated schemes in DOM mode', () => {
    for (const payload of vectors) {
      const cleaned = sanitizeHtml(payload)
      expect(cleaned).not.toMatch(/<script\b/i)
      expect(cleaned).not.toMatch(/<iframe\b/i)
      expect(cleaned).not.toMatch(/<object\b/i)
      expect(cleaned).not.toMatch(/<embed\b/i)
      expect(cleaned).not.toMatch(/<form\b/i)
      expect(cleaned).not.toMatch(/<style\b/i)
      expect(cleaned).not.toMatch(/<foreignobject\b/i)
      expect(cleaned).not.toMatch(/<animate\b/i)
      expect(cleaned).not.toMatch(/<set\b/i)
      expect(cleaned).not.toMatch(/\bon[a-z]+\s*=/i)
      expect(cleaned).not.toMatch(/javascript:/i)
      expect(cleaned).not.toMatch(/vbscript:/i)
      expect(cleaned).not.toMatch(/data:text\/html/i)
      expect(cleaned).not.toMatch(/data:image\/svg\+xml/i)
    }
    expect(sanitizeHtml('<p>Hello <strong>world</strong></p>')).toContain(
      '<strong>world</strong>',
    )
    expect(
      sanitizeHtml(
        '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"></circle></svg>',
      ),
    ).toContain('<circle')
  })

  it('enforces the same protections in non-DOM (Node) fallback mode', () => {
    const savedParser = globalThis.DOMParser
    // @ts-expect-error simulating Node environment without DOMParser
    globalThis.DOMParser = undefined
    try {
      for (const payload of vectors) {
        const cleaned = sanitizeHtml(payload)
        expect(cleaned).not.toMatch(/<script\b/i)
        expect(cleaned).not.toMatch(/<iframe\b/i)
        expect(cleaned).not.toMatch(/<foreignobject\b/i)
        expect(cleaned).not.toMatch(/\bon[a-z]+\s*=/i)
        expect(cleaned).not.toMatch(/javascript:/i)
        expect(cleaned).not.toMatch(/data:text\/html/i)
        expect(cleaned).not.toMatch(/data:image\/svg\+xml/i)
      }
    } finally {
      globalThis.DOMParser = savedParser
    }
  })

  it('strictly validates gallery and URL schemes', () => {
    expect(isSafeUrl('assets/photo.png', 'gallery-src')).toBe(true)
    expect(isSafeUrl('https://example.com/a.png', 'gallery-src')).toBe(true)
    expect(isSafeUrl('javascript:alert(1)', 'gallery-src')).toBe(false)
    expect(isSafeUrl('data:image/svg+xml;base64,PHN2Zz4=', 'gallery-src')).toBe(false)
    expect(isSafeUrl('../../etc/passwd', 'gallery-src')).toBe(false)
    expect(isSafeUrl('/etc/passwd', 'gallery-src')).toBe(false)
    expect(isSafeUrl('assets\\..\\secret.png', 'gallery-src')).toBe(false)
  })
})

describe('A.2 SVG upload validation & path normalization', () => {
  it('blocks malicious SVG payloads in importKnowledgeImages before writing any files', async () => {
    const badSvg = Buffer.from('<svg onload="alert(1)"><script>x()</script></svg>').toString('base64')
    vi.mocked(readPlatformFileBinary).mockResolvedValueOnce({
      path: '/tmp/evil.svg',
      mimeType: 'image/svg+xml',
      base64: badSvg,
      truncated: false,
      byteLength: 48,
    })
    await expect(
      importKnowledgeImages('/wiki/brand.knowledge/', [{ sourcePath: '/tmp/evil.svg' }]),
    ).rejects.toThrow(/active|unsupported/i)
    expect(writePlatformFileBinary).not.toHaveBeenCalled()
  })

  it('normalizes trailing slashes and returns normalized mimeType in saveKnowledgeImage', async () => {
    const saved = await saveKnowledgeImage('/wiki/brand.knowledge///', {
      name: 'photo.jpg',
      alt: 'Photo',
      bytes: new Uint8Array([0xff, 0xd8, 0xff]),
      mimeType: 'image/jpg',
    })
    expect(saved.mimeType).toBe('image/jpeg')
    expect(saved.dataUrl).toMatch(/^data:image\/jpeg;base64,/)
    expect(saved.absolutePath).toMatch(/^\/wiki\/brand\.knowledge\/assets\//)
    expect(saved.absolutePath).not.toContain('//assets')
  })
})

describe('A.3 Path traversal & external file:// rejection', () => {
  it('rejects traversal, absolute paths, backslashes, and out-of-package file:// URLs', async () => {
    const pkg = '/wiki/team.knowledge'
    expect(resolveSafePackageRelativeAssetPath('../../etc/passwd', pkg)).toBeNull()
    expect(resolveSafePackageRelativeAssetPath('%2e%2e/secret.png', pkg)).toBeNull()
    expect(resolveSafePackageRelativeAssetPath('/etc/passwd', pkg)).toBeNull()
    expect(resolveSafePackageRelativeAssetPath('assets\\..\\secret.png', pkg)).toBeNull()
    expect(resolveSafePackageRelativeAssetPath('file:///etc/passwd', pkg)).toBeNull()
    expect(
      resolveSafePackageRelativeAssetPath('file:///wiki/team.knowledge/assets/ok.png', pkg),
    ).toBe('assets/ok.png')

    const readBinary = vi.fn(async () => ({ mimeType: 'image/png', base64: 'iVBORw==' }))
    const fileUrlFor = vi.fn(async (p: string) => `purescience-fs://asset/${p}`)
    const md = [
      '![Traversal](../../etc/passwd)',
      '![Abs](/etc/passwd)',
      '![Backslash](assets\\..\\secret.png)',
      '![OutsideFile](file:///etc/passwd)',
      '![Valid](assets/good.png)',
    ].join('\n\n')

    await prepareKnowledgeDocumentHtml(md, pkg, readBinary)
    expect(readBinary).toHaveBeenCalledTimes(1)
    expect(readBinary).toHaveBeenCalledWith('/wiki/team.knowledge/assets/good.png')

    await prepareKnowledgeDocumentHtmlWithUrls(md, pkg, fileUrlFor)
    expect(fileUrlFor).toHaveBeenCalledTimes(1)
    expect(fileUrlFor).toHaveBeenCalledWith('/wiki/team.knowledge/assets/good.png')
  })
})

describe('A.4 DOM wikilink rendering', () => {
  it('supports piped wikilinks, unescaped punctuation without double-escaping, and skips code/pre/a/attributes', () => {
    const html = [
      '<p title="[[AttrLink]]">See [[R&amp;D &quot;Alpha&quot; O&#39;Connor|Research &amp; Dev]] and [[Missing Page]].</p>',
      '<pre><code>[[CodeBlockLink]]</code></pre>',
      '<p>Inline <code>[[InlineCodeLink]]</code> and <a href="https://example.com">[[AnchorLink]]</a></p>',
    ].join('')
    const rendered = renderWikiLinksInHtml(
      html,
      target => target === 'R&D "Alpha" O\'Connor',
    )
    const doc = new DOMParser().parseFromString(rendered, 'text/html')
    const links = Array.from(doc.querySelectorAll<HTMLAnchorElement>('a[data-wiki-title]'))
    expect(links).toHaveLength(2)
    expect(links[0]!.getAttribute('data-wiki-title')).toBe('R&D "Alpha" O\'Connor')
    expect(links[0]!.textContent).toBe('Research & Dev')
    expect(links[0]!.classList.contains('is-missing')).toBe(false)
    expect(links[1]!.getAttribute('data-wiki-title')).toBe('Missing Page')
    expect(links[1]!.classList.contains('is-missing')).toBe(true)
    expect(doc.querySelector('p')!.getAttribute('title')).toBe('[[AttrLink]]')
    expect(doc.querySelector('pre code')!.textContent).toBe('[[CodeBlockLink]]')
    expect(doc.querySelector('p > code')!.textContent).toBe('[[InlineCodeLink]]')
    expect(doc.querySelector('a[href="https://example.com"]')!.textContent).toBe('[[AnchorLink]]')
    expect(rendered).not.toContain('&amp;amp;')
  })
})

describe('B.5, B.6, B.8, B.10 Persistence, External Merge, Gallery & Search', () => {
  it('parses CRLF page files in parsePageFile and parseOrganisationPage', () => {
    const store = createDefaultKnowledgeStore()
    const page = store.pages[0]!
    const crlf = serializePageFile(page).replace(/\n/g, '\r\n')
    const parsed = parsePageFile(crlf)
    expect(parsed).not.toBeNull()
    expect(parsed!.id).toBe(page.id)
    expect(parsed!.body).toBe(page.body)

    const orgParsed = parseOrganisationPage(
      crlf,
      JSON.parse(serializeKnowledgeIndex(store)),
    )
    expect(orgParsed.id).toBe(page.id)
  })

  it('does not flag false conflicts when incoming page did not change vs durable, and merges proposals safely', () => {
    let base = createDefaultKnowledgeStore()
    base = createKnowledgePage(base, {
      spaceId: base.activeSpaceId,
      parentId: base.spaces[0]!.rootPageId,
      kind: 'wiki',
      title: 'Page A',
      body: 'Original A',
    })
    const pageAId = base.activePageId!
    base = createKnowledgePage(base, {
      spaceId: base.activeSpaceId,
      parentId: base.spaces[0]!.rootPageId,
      kind: 'wiki',
      title: 'Page B',
      body: 'Original B',
    })
    const pageBId = base.activePageId!
    base = proposeKnowledgeAgentChange(base, {
      spaceId: base.activeSpaceId,
      pageId: pageAId,
      agentName: 'Bot',
      changeType: 'page.update',
      title: 'Tweak A',
      summary: 'Improve A',
      patch: { body: 'Bot A' },
    })
    const changeId = base.agentChanges![0]!.id

    // Local edits A and rejects the proposal; disk only edits B (A unchanged vs base, proposal still pending)
    let local = updateKnowledgePage(base, pageAId, { body: 'Local edit A' })
    local = {
      ...local,
      agentChanges: local.agentChanges!.map(c =>
        c.id === changeId
          ? { ...c, status: 'rejected' as const, reviewedAt: new Date().toISOString() }
          : c,
      ),
    }
    const incoming = updateKnowledgePage(base, pageBId, { body: 'Disk edit B' })

    const merged = mergeExternalKnowledgeStore(local, incoming, base)
    expect(merged.conflicts).toEqual([])
    expect(merged.store.pages.find(p => p.id === pageAId)?.body).toBe('Local edit A')
    expect(merged.store.pages.find(p => p.id === pageBId)?.body).toBe('Disk edit B')
    expect(merged.store.agentChanges?.find(c => c.id === changeId)?.status).toBe('rejected')
  })

  it('handles $& / $$ in gallery serialization, strips figcaption newlines, and ignores invalid galleries', () => {
    const html = `<div data-knowledge-gallery="" data-thumbnail-size="96"><figure><img src="assets/a.png" alt="Price"><figcaption>Cost $&amp;
and $$50</figcaption></figure></div>`
    const md = knowledgeHtmlToMarkdown(html, '/kb/test.knowledge')
    expect(md).toContain('![Cost $& and $$50](assets/a.png)')
    expect(md).not.toContain('PUREKNOWLEDGEGALLERYBLOCK')

    // Invalid empty/unclosed gallery before a valid gallery must not shift index
    const withInvalid = [
      ':::gallery',
      ':::',
      '',
      ':::gallery',
      '![First](assets/first.png)',
      ':::',
    ].join('\n')
    const appended = appendKnowledgeGalleryImages(withInvalid, 0, [
      { alt: 'Second', src: 'assets/second.png' },
    ])
    expect(appended).toContain('![First](assets/first.png)\n![Second](assets/second.png)')

    // Unsafe gallery image scheme is rejected
    const badGallery = ':::gallery\n![Evil](javascript:alert(1))\n:::'
    expect(knowledgeMarkdownToHtml(badGallery)).not.toContain('javascript:')
  })

  it('skips code blocks/inline code in extractWikiLinks and heading parsers, supports piped links, excludes retired/archived in review, and boosts exact titles', () => {
    const body = [
      '# Real Heading',
      'Link to [[Target Page|Display Text]] and `[[InlineSkip]]`.',
      '```bash',
      '# Fake Heading In Code',
      'echo "[[FenceSkip]]"',
      '```',
      '## Second Heading',
    ].join('\n')
    expect(extractWikiLinks(body)).toEqual(['Target Page'])
    expect(extractMarkdownHeadings(body).map(h => h.text)).toEqual([
      'Real Heading',
      'Second Heading',
    ])

    let store = createDefaultKnowledgeStore()
    store = createKnowledgePage(store, {
      spaceId: store.activeSpaceId,
      parentId: store.spaces[0]!.rootPageId,
      kind: 'wiki',
      title: 'Current Notes',
      body: 'Mentions release checklist briefly.',
    })
    store = updateKnowledgePage(store, store.activePageId!, {
      guidanceStatus: 'current',
    })
    store = createKnowledgePage(store, {
      spaceId: store.activeSpaceId,
      parentId: store.spaces[0]!.rootPageId,
      kind: 'wiki',
      title: 'Release Checklist',
      body: 'Steps to ship.',
    })
    const exactId = store.activePageId!
    const hits = rankKnowledgePages(store, 'Release Checklist', 10)
    expect(hits[0]?.page.id).toBe(exactId)

    // Retired & archived pages excluded from reviewKnowledgeStore
    const oldDate = '2020-01-01T00:00:00.000Z'
    const withRetired: KnowledgeStore = {
      ...store,
      pages: [
        ...store.pages,
        {
          id: 'page-retired',
          spaceId: store.activeSpaceId,
          parentId: store.spaces[0]!.rootPageId,
          kind: 'wiki',
          slug: 'retired-old',
          title: 'Retired Old',
          body: '[[BrokenRef]]',
          tags: [],
          links: [],
          createdAt: oldDate,
          updatedAt: oldDate,
          guidanceStatus: 'retired',
        },
        {
          id: 'page-archived',
          spaceId: store.activeSpaceId,
          parentId: store.spaces[0]!.rootPageId,
          kind: 'wiki',
          slug: 'archived-old',
          title: 'Archived Old',
          body: '[[BrokenRef2]]',
          tags: [],
          links: [],
          createdAt: oldDate,
          updatedAt: oldDate,
          governance: { category: 'policy', archived: true },
        },
      ],
    }
    const findings = reviewKnowledgeStore(withRetired, store.activeSpaceId, Date.now())
    expect(findings.some(f => f.pageId === 'page-retired')).toBe(false)
    expect(findings.some(f => f.pageId === 'page-archived')).toBe(false)

    // Passages & readOrganisationKnowledge skip fenced headings and root query includes parentId: null
    const samplePage = store.pages[0]!
    const passages = knowledgePagePassages({ ...samplePage, body })
    expect(
      passages.some(p =>
        p.text.startsWith(`${samplePage.title} — Fake Heading In Code`),
      ),
    ).toBe(false)

    const orgStore = createKnowledgePage(store, {
      spaceId: store.activeSpaceId,
      parentId: null,
      kind: 'wiki',
      title: 'Top Level Null Parent',
      body,
    })
    const orgIndex = JSON.parse(serializeKnowledgeIndex(orgStore))
    const rootQuery = queryOrganisationKnowledge(orgIndex, orgStore.pages, {})
    expect(rootQuery.pages.some(p => p.title === 'Top Level Null Parent')).toBe(true)
    const orgRead = readOrganisationKnowledge(orgIndex, orgStore.pages, {
      page: orgStore.activePageId!,
    })
    expect(orgRead.headings).toEqual(['Real Heading', 'Second Heading'])
  })
})

describe('B.11 PolicyPanel local draft editing', () => {
  it('preserves newlines and spaces while typing in Sources and commits parsed lines on blur', async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const host = document.body.appendChild(document.createElement('div'))
    const root = createRoot(host)
    const onChange = vi.fn()
    const page: KnowledgePage = {
      ...createDefaultKnowledgeStore().pages[0]!,
      title: 'Security Policy',
      body: 'Follow least privilege.',
      tags: ['policy'],
      governance: { category: 'policy', owner: 'Ops', sources: ['Line one'] },
    }
    await act(async () => {
      root.render(
        createElement(PolicyPanel, {
          key: page.id,
          page,
          editing: false,
          onChange,
        }),
      )
    })
    const textarea = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Policy sources"]')!
    const setVal = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!

    await act(async () => {
      textarea.focus()
      setVal.call(textarea, 'Line one \nLine two ')
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    })
    // Local draft keeps trailing newline/space without immediately calling onChange
    expect(textarea.value).toBe('Line one \nLine two ')
    expect(onChange).not.toHaveBeenCalled()

    await act(async () => {
      textarea.blur()
    })
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0]![0].governance.sources).toEqual([
      'Line one',
      'Line two',
    ])

    await act(async () => root.unmount())
    host.remove()
  })
})

describe('B.13 & C.15 Agent handlers, page.merge, and management helpers', () => {
  it('preserves source tags, links, aliases, and reparents children on page.merge', () => {
    let store = createDefaultKnowledgeStore()
    const rootId = store.spaces[0]!.rootPageId
    store = createKnowledgePage(store, {
      spaceId: store.activeSpaceId,
      parentId: rootId,
      kind: 'wiki',
      title: 'Survivor',
      body: 'Survivor body',
      tags: ['core'],
    })
    const survivorId = store.activePageId!
    store = createKnowledgePage(store, {
      spaceId: store.activeSpaceId,
      parentId: rootId,
      kind: 'wiki',
      title: 'Source Page',
      body: 'Source body',
      tags: ['extra', 'core'],
    })
    const sourceId = store.activePageId!
    store = updateKnowledgePage(store, sourceId, { aliases: ['Old Name'] })
    store = addKnowledgeLink(store, sourceId, {
      type: 'url',
      title: 'Spec',
      url: 'https://example.com/spec',
    })
    store = createKnowledgePage(store, {
      spaceId: store.activeSpaceId,
      parentId: sourceId,
      kind: 'wiki',
      title: 'Child Of Source',
      body: 'Keep me!',
    })
    const childId = store.activePageId!

    const merged = applyKnowledgeAgentChange(store, {
      spaceId: store.activeSpaceId,
      pageId: sourceId,
      agentName: 'Curator',
      changeType: 'page.merge',
      title: 'Source Page',
      summary: 'Merge into Survivor',
      patch: { mergeIntoPageId: survivorId, body: 'Combined body' },
    })

    expect(merged.pages.some(p => p.id === sourceId)).toBe(false)
    const survivor = merged.pages.find(p => p.id === survivorId)!
    expect(survivor.body).toBe('Combined body')
    expect(survivor.tags).toEqual(expect.arrayContaining(['core', 'extra']))
    expect(survivor.aliases).toEqual(expect.arrayContaining(['Old Name', 'Source Page']))
    expect(survivor.links.some(l => l.url === 'https://example.com/spec')).toBe(true)
    const child = merged.pages.find(p => p.id === childId)!
    expect(child).toBeDefined()
    expect(child.parentId).toBe(survivorId)
  })

  it('catches corrupt publication, filters archived pages, scopes duplicate check, recomputes statusLabel, returns pageId, and checks root move before asset import', async () => {
    let store = createDefaultKnowledgeStore()
    const rootId = store.spaces[0]!.rootPageId!
    store = createKnowledgePage(store, {
      spaceId: store.activeSpaceId,
      parentId: rootId,
      kind: 'wiki',
      title: 'Corrupt Policy',
      body: 'Draft text',
      tags: ['policy'],
    })
    const corruptId = store.activePageId!
    store = updateKnowledgePage(store, corruptId, {
      governance: {
        category: 'policy',
        publication: { content: '{not-json', by: 'You', at: '2026-01-01T00:00:00Z' },
      },
    })
    store = createKnowledgePage(store, {
      spaceId: store.activeSpaceId,
      parentId: rootId,
      kind: 'wiki',
      title: 'Archived Guide',
      body: 'Old text',
    })
    const archivedId = store.activePageId!
    store = updateKnowledgePage(store, archivedId, {
      governance: { category: 'reference', archived: true },
    })

    let current = store
    const context = {
      get store() {
        return current
      },
      storePath: '/kb/test.knowledge',
      saveStore: async (
        update: KnowledgeStore | ((s: KnowledgeStore) => KnowledgeStore),
      ) => {
        current = typeof update === 'function' ? update(current) : update
      },
    }

    // searchKnowledge catches corrupt publication instead of throwing
    const searchResult = await searchKnowledgeHandler(context, { query: 'Corrupt' })
    expect(searchResult.isError).toBeUndefined()

    // readKnowledgePage catches corrupt publication cleanly
    const corruptRead = readKnowledgePageHandler(context, { page: corruptId })
    expect(corruptRead.isError).toBe(true)

    // readKnowledgePage filters archived page by default, allows with includeDrafts
    const archivedRead = readKnowledgePageHandler(context, { page: archivedId })
    expect(archivedRead.isError).toBe(true)
    const archivedDraftRead = readKnowledgePageHandler(context, {
      page: archivedId,
      includeDrafts: true,
    })
    expect(archivedDraftRead.isError).toBeUndefined()

    // Duplicate title check is scoped to target space (same title in another space succeeds!)
    current = createKnowledgeSpace(current, { name: 'Second Space' })
    const secondCreate = await applyKnowledgeChangeHandler(context, {
      action: 'create',
      title: 'Archived Guide',
      body: 'Fresh guide in second space',
      summary: 'Create in second space',
    })
    expect(secondCreate.isError).toBeUndefined()
    const createdPayload = JSON.parse(secondCreate.content)
    expect(createdPayload.pageId).toBeTruthy()

    // Recomputes statusLabel on guidance
    const guidanceRes = await applyKnowledgeChangeHandler(context, {
      action: 'guidance',
      page: createdPayload.pageId,
      guidanceStatus: 'current',
      summary: 'Mark current',
    })
    expect(guidanceRes.isError).toBeUndefined()
    const latestChange = current.agentChanges![0]!
    expect(JSON.parse(latestChange.after!).statusLabel).toBe('Current')

    // Validates root move BEFORE importing assets
    const secondRootId = current.spaces.find(s => s.name === 'Second Space')!.rootPageId!
    const rootMoveRes = await applyKnowledgeChangeHandler(context, {
      action: 'update',
      page: secondRootId,
      parent: createdPayload.pageId,
      body: 'Try moving root',
      importAssets: [{ sourcePath: '/tmp/pic.png' }],
      summary: 'Invalid root move',
    })
    expect(rootMoveRes.isError).toBe(true)
    expect(readPlatformFileBinary).not.toHaveBeenCalled()
  })

  it('supports renameKnowledgeSpace, removeKnowledgeLink, and backlink-aware page rename', () => {
    let store = createDefaultKnowledgeStore()
    const spaceId = store.activeSpaceId
    store = renameKnowledgeSpace(store, spaceId, 'Engineering')
    expect(store.spaces.find(s => s.id === spaceId)?.name).toBe('Engineering')

    const rootId = store.spaces[0]!.rootPageId!
    store = addKnowledgeLink(store, rootId, {
      type: 'url',
      title: 'Docs',
      url: 'https://example.com',
    })
    const linkId = store.pages.find(p => p.id === rootId)!.links[0]!.id
    store = removeKnowledgeLink(store, rootId, linkId)
    expect(store.pages.find(p => p.id === rootId)!.links).toHaveLength(0)

    store = createKnowledgePage(store, {
      spaceId,
      parentId: rootId,
      kind: 'wiki',
      title: 'New Title',
      body: 'Target page',
    })
    const targetId = store.activePageId!
    store = createKnowledgePage(store, {
      spaceId,
      parentId: rootId,
      kind: 'wiki',
      title: 'Referrer',
      body: 'See [[Old Title]] and [[Old Title|alias]] and `[[Old Title]]`.',
    })
    const refId = store.activePageId!

    expect(
      rewriteWikiLinksForRename(
        'See [[Old Title]] and [[Old Title|alias]] and `[[Old Title]]`.',
        'Old Title',
        'New Title',
      ),
    ).toBe('See [[New Title]] and [[New Title|alias]] and `[[Old Title]]`.')

    const updated = renameKnowledgePageWithBacklinks(
      store,
      targetId,
      'Old Title',
      'New Title',
      'update-links',
    )
    expect(updated.pages.find(p => p.id === refId)?.body).toBe(
      'See [[New Title]] and [[New Title|alias]] and `[[Old Title]]`.',
    )

    const aliased = renameKnowledgePageWithBacklinks(
      store,
      targetId,
      'Old Title',
      'New Title',
      'add-alias',
    )
    expect(aliased.pages.find(p => p.id === targetId)?.aliases).toContain('Old Title')
  })
})

describe('Adversarial review hardening regression tests', () => {
  it('blocks raw purescience-fs:// in Markdown/gallery and only permits it on verified prepared images', async () => {
    expect(isSafeUrl('purescience-fs://asset/secret', 'gallery-src')).toBe(false)
    expect(isSafeUrl('purescience-fs://asset/secret', 'img-src')).toBe(false)
    expect(
      sanitizeHtml('<img src="purescience-fs://asset/stolen" alt="x">'),
    ).not.toContain('purescience-fs://')
    expect(
      sanitizeHtml('<img src="purescience-fs://asset/stolen" alt="x">', {
        allowPreparedFsUrls: true,
      }),
    ).not.toContain('purescience-fs://')
    expect(
      sanitizeHtml(
        '<img src="purescience-fs://asset/ok" data-writer-asset-src="assets/ok.png" alt="ok">',
        { allowPreparedFsUrls: true },
      ),
    ).toContain('purescience-fs://asset/ok')

    expect(
      knowledgeMarkdownToHtml('![Stolen](purescience-fs://asset/secret)'),
    ).not.toContain('purescience-fs://')

    const fileUrlFor = vi.fn(async () => 'purescience-fs://asset/resolved')
    const prepared = await prepareKnowledgeDocumentHtmlWithUrls(
      '![Stolen](purescience-fs://asset/raw-attempt)',
      '/kb/demo.knowledge',
      fileUrlFor,
    )
    expect(prepared.html).not.toContain('purescience-fs://asset/raw-attempt')
    expect(fileUrlFor).not.toHaveBeenCalled()
  })

  it('hardens DOMParser mXSS, CSS escape/comment smuggling, and YouTube iframe allowlist', () => {
    const mxss =
      '<math><mtext><img src=x onerror=alert(1)></mtext></math><annotation-xml><script>alert(1)</script></annotation-xml><svg><title><img src=x onerror=alert(1)></title><desc>bad</desc><circle cx="5" cy="5" r="2"></circle></svg>'
    const cleanedMxss = sanitizeHtml(mxss)
    expect(cleanedMxss).not.toMatch(/<math|<annotation-xml|<title|<desc|onerror|<script/i)
    expect(cleanedMxss).toContain('<circle')

    const cssBypass =
      '<div style="background: u\\72l(https://evil.com); width: exp/*c*/ression(alert(1))">Text</div>'
    const cleanedCss = sanitizeHtml(cssBypass)
    expect(cleanedCss).not.toContain('style=')

    const videoHtml =
      '<figure data-video-source="https://www.youtube.com/watch?v=dQw4w9WgXcQ"><iframe src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ" allow="camera; microphone; encrypted-media; fullscreen; geolocation"></iframe></figure>'
    const cleanedVideo = sanitizeHtml(videoHtml, { allowTrustedVideoIframes: true })
    expect(cleanedVideo).toContain('encrypted-media; fullscreen')
    expect(cleanedVideo).not.toContain('camera')
    expect(cleanedVideo).not.toContain('microphone')
    expect(cleanedVideo).not.toContain('geolocation')
  })

  it('hardens Node fallback against nested tags, quote/slash smuggling, unclosed iframes, srcset, and SVG namespace prefixes', () => {
    const savedParser = globalThis.DOMParser
    // @ts-expect-error simulating Node environment
    globalThis.DOMParser = undefined
    try {
      const nested = sanitizeHtml('<scr<script>ipt>alert(1)</scr</script>ipt>')
      expect(nested).not.toMatch(/<script/i)

      const slashAttr = sanitizeHtml('<img/src="https://example.com/a.png"/onerror=alert(1)>')
      expect(slashAttr).not.toMatch(/onerror/i)

      const quoteGt = sanitizeHtml('<img alt="a>b" onerror="alert(1)" src="https://example.com/a.png">')
      expect(quoteGt).not.toMatch(/onerror/i)

      const unclosedIframe = sanitizeHtml(
        '<iframe src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"><p>smuggled</p>',
        { allowTrustedVideoIframes: true },
      )
      expect(unclosedIframe).not.toMatch(/<iframe/i)

      const badSrcset = sanitizeHtml(
        '<img src="https://example.com/ok.png" srcset="javascript:alert(1) 1x, https://example.com/2x.png 2x">',
      )
      expect(badSrcset).not.toContain('javascript:')
      expect(badSrcset).toContain('https://example.com/2x.png')

      const nsSvg = sanitizeHtml(
        '<svg><svg:script>alert(1)</svg:script><a foo:href="javascript:alert(1)">x</a></svg>',
      )
      expect(nsSvg).not.toMatch(/script|javascript:|foo:href/i)
    } finally {
      globalThis.DOMParser = savedParser
    }
  })

  it('blocks SVG DTD/entity/xml-stylesheet/parsererror/CSS-escape/custom-href/discard and fails closed on bad MIME or base64', async () => {
    expect(hasDangerousSvgContent('<!DOCTYPE svg [<!ENTITY xxe "x">]><svg/>')).toBe(true)
    expect(hasDangerousSvgContent('<?xml-stylesheet type="text/xsl" href="a.xsl"?><svg/>')).toBe(true)
    expect(hasDangerousSvgContent('<svg><rect></svg>')).toBe(true)
    expect(hasDangerousSvgContent('<svg><style>a{background:u\\72l(https://evil.com)}</style></svg>')).toBe(true)
    expect(hasDangerousSvgContent('<svg xmlns:x="http://www.w3.org/1999/xlink"><a x:href="https://evil.com"><rect/></a></svg>')).toBe(true)
    expect(hasDangerousSvgContent('<svg><discard begin="0s"/></svg>')).toBe(true)
    expect(hasDangerousSvgContent('<svg><animateColor attributeName="fill"/></svg>')).toBe(true)

    const badMimeResult = await prepareKnowledgeDocumentHtml(
      '![Bad](assets/weird.bin)',
      '/kb/test.knowledge',
      async () => ({ mimeType: 'text/html', base64: 'PHNjcmlwdD4=' }),
    )
    expect(badMimeResult.imageFailures).toHaveLength(1)
    expect(badMimeResult.html).not.toContain('data:text/html')

    const badBase64Svg = await prepareKnowledgeDocumentHtml(
      '![Broken](assets/broken.svg)',
      '/kb/test.knowledge',
      async () => ({ mimeType: 'image/svg+xml', base64: '!!!not-valid-base64!!!' }),
    )
    expect(badBase64Svg.imageFailures).toHaveLength(1)
    expect(badBase64Svg.html).not.toContain('data:image/svg+xml')
  })

  it('blocks ?, #, encoded control chars, double-encoded traversal while allowing literal % filenames', () => {
    const pkg = '/kb/demo.knowledge'
    expect(resolveSafePackageRelativeAssetPath('assets/a.png?v=1', pkg)).toBeNull()
    expect(resolveSafePackageRelativeAssetPath('assets/a.png#frag', pkg)).toBeNull()
    expect(resolveSafePackageRelativeAssetPath('assets/a%00.png', pkg)).toBeNull()
    expect(resolveSafePackageRelativeAssetPath('%252e%252e/etc/passwd', pkg)).toBeNull()
    expect(resolveSafePackageRelativeAssetPath('assets/100%_chart.png', pkg)).toBe(
      'assets/100%_chart.png',
    )
    expect(
      isAbsolutePathInsidePackage('/kb/demo.knowledge/assets/100%_chart.png', pkg),
    ).toBe(true)
  })

  it('performs 3-way links merge so concurrent edits do not resurrect deleted links', () => {
    const store = createDefaultKnowledgeStore()
    const base: KnowledgePage = {
      ...store.pages[0]!,
      links: [
        { id: 'link-keep', type: 'url', title: 'Keep', url: 'https://keep.test' },
        { id: 'link-del', type: 'url', title: 'Del', url: 'https://del.test' },
      ],
    }
    const mine: KnowledgePage = {
      ...base,
      links: [
        base.links[0]!,
        { id: 'link-mine', type: 'url', title: 'Mine', url: 'https://mine.test' },
      ],
      updatedAt: '2026-11-21T01:00:00.000Z',
    }
    const disk: KnowledgePage = {
      ...base,
      body: 'Disk edited body',
      links: [
        ...base.links,
        { id: 'link-disk', type: 'url', title: 'Disk', url: 'https://disk.test' },
      ],
      updatedAt: '2026-11-21T00:59:00.000Z',
    }
    const outcome = resolvePageSave({ base, mine, disk })
    expect(outcome.kind).toBe('write')
    if (outcome.kind === 'write') {
      const ids = outcome.page.links.map(l => l.id)
      expect(ids).toContain('link-keep')
      expect(ids).toContain('link-mine')
      expect(ids).toContain('link-disk')
      expect(ids).not.toContain('link-del')
    }
  })

  it('aligns Page Outline headings with rendered DOM IDs, preserves entities in wikilink fallback, and avoids mutating unrelated escaped links on rename', () => {
    const anchored = addHeadingAnchorsToHtml(
      '<h2><strong>Setup</strong> &amp; <a href="#" data-wiki-title="Guide">the guide</a></h2><h3>Details</h3>',
    )
    expect(anchored.headings).toEqual([
      { id: 'heading-setup-the-guide', text: 'Setup & the guide', level: 2 },
      { id: 'heading-details', text: 'Details', level: 3 },
    ])
    expect(anchored.html).toContain('id="heading-setup-the-guide"')

    expect(
      renderWikiLinksInHtml('<svg><text>[[SvgSkip]]</text></svg><p>[[Real]]</p>', () => true),
    ).not.toContain('data-wiki-title="SvgSkip"')

    const savedParser = globalThis.DOMParser
    // @ts-expect-error simulating Node environment
    globalThis.DOMParser = undefined
    try {
      const fallback = renderWikiLinksInHtml(
        '<p>Hello&nbsp;world &mdash; [[Page]]</p><textarea>[[SkipTA]]</textarea>',
        () => true,
      )
      expect(fallback).toContain('Hello&nbsp;world &mdash;')
      expect(fallback).toContain('data-wiki-title="Page"')
      expect(fallback).not.toContain('data-wiki-title="SkipTA"')
    } finally {
      globalThis.DOMParser = savedParser
    }

    // rewriteWikiLinksForRename must not mutate unrelated escaped links
    const unrelated = 'See \\[\\[Other Page\\]\\] only.'
    expect(rewriteWikiLinksForRename(unrelated, 'Old Title', 'New Title')).toBe(
      unrelated,
    )
  })

  it('publishes atomically in PolicyPanel without blur-before-click race and aligns search/merge agent handlers', async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const host = document.body.appendChild(document.createElement('div'))
    const root = createRoot(host)
    const onChange = vi.fn()
    const page: KnowledgePage = {
      ...createDefaultKnowledgeStore().pages[0]!,
      title: 'Atomic Policy',
      body: 'Rules.',
      tags: ['policy'],
      governance: { category: 'policy', owner: 'Ops', reviewDue: '2099-01-01', sources: [] },
    }
    await act(async () => {
      root.render(createElement(PolicyPanel, { key: page.id, page, editing: false, onChange }))
    })
    const textarea = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Policy sources"]')!
    const setVal = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
    await act(async () => {
      textarea.focus()
      setVal.call(textarea, 'Board minutes')
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const publishBtn = host.querySelector<HTMLButtonElement>('button[data-pureknowledge-primary]')!
    await act(async () => {
      const mouseDown = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
      publishBtn.dispatchEvent(mouseDown)
      expect(mouseDown.defaultPrevented).toBe(true)
      publishBtn.click()
    })
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0]![0].governance.publication).toBeTruthy()
    expect(onChange.mock.calls[0]![0].governance.sources).toEqual(['Board minutes'])
    await act(async () => root.unmount())
    host.remove()

    // searchKnowledge includeDrafts includes archived pages + cross-space merge rejected
    let store = createDefaultKnowledgeStore()
    const rootId = store.spaces[0]!.rootPageId!
    store = createKnowledgePage(store, {
      spaceId: store.activeSpaceId,
      parentId: rootId,
      kind: 'wiki',
      title: 'Archived Reference',
      body: 'Archived details',
    })
    const archivedId = store.activePageId!
    store = updateKnowledgePage(store, archivedId, {
      governance: { category: 'reference', archived: true },
    })
    store = createKnowledgeSpace(store, { name: 'Other Space' })
    const otherRoot = store.spaces.find(s => s.name === 'Other Space')!.rootPageId!
    store = createKnowledgePage(store, {
      spaceId: store.activeSpaceId,
      parentId: otherRoot,
      kind: 'wiki',
      title: 'Other Target',
      body: 'Target body',
    })
    const otherTargetId = store.activePageId!

    const saveStore = vi.fn(async () => undefined)
    const context = { store, storePath: '/kb/test.knowledge', saveStore }
    const defaultSearch = await searchKnowledgeHandler(context, { query: 'Archived Reference' })
    expect(JSON.parse(defaultSearch.content).pages).toHaveLength(0)
    const draftSearch = await searchKnowledgeHandler(context, {
      query: 'Archived Reference',
      includeDrafts: true,
    })
    expect(JSON.parse(draftSearch.content).pages).toHaveLength(1)

    const crossSpaceMerge = await applyKnowledgeChangeHandler(context, {
      action: 'merge',
      page: archivedId,
      into: otherTargetId,
      body: 'Merged across spaces',
      summary: 'Cross space merge',
    })
    expect(crossSpaceMerge.isError).toBe(true)
    expect(saveStore).not.toHaveBeenCalled()
  })
})
