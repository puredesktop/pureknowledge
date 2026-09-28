// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  prepareKnowledgeDocumentHtml,
  readKnowledgeImagePreview,
} from './knowledgeDocumentHtml'

describe('prepareKnowledgeDocumentHtml', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders a package-relative gallery containing SVG and PNG images', async () => {
    const readBinary = vi.fn(async (path: string) => {
      if (path.endsWith('.svg')) {
        return { mimeType: 'image/svg+xml', base64: 'PHN2Zz48L3N2Zz4=' }
      }
      return { mimeType: 'image/png', base64: 'iVBORw==' }
    })

    const result = await prepareKnowledgeDocumentHtml(
      [
        '## Gallery',
        '',
        '![App tile](assets/tile.svg)',
        '',
        '![Pitch slide](assets/slide.png)',
      ].join('\n'),
      '/wiki/brand.knowledge',
      readBinary,
    )

    expect(readBinary).toHaveBeenCalledWith(
      '/wiki/brand.knowledge/assets/tile.svg',
    )
    expect(readBinary).toHaveBeenCalledWith(
      '/wiki/brand.knowledge/assets/slide.png',
    )
    expect(result.html).toContain('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=')
    expect(result.html).toContain('data:image/png;base64,iVBORw==')
    expect(result.html).toContain('data-writer-asset-src="assets/tile.svg"')
    expect(result.html).toContain('data-knowledge-image-preview=""')
    expect(result.html).toContain('aria-label="Open App tile larger"')
    expect(result.html).toContain('tabindex="0"')
    expect(result.imageFailures).toEqual([])

    const container = document.createElement('div')
    container.innerHTML = result.html
    expect(readKnowledgeImagePreview(container.querySelector('img'))).toEqual({
      src: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
      alt: 'App tile',
      path: 'assets/tile.svg',
    })
  })

  it('loads package assets inside a durable gallery block', async () => {
    const readBinary = vi.fn(async (path: string) => ({
      mimeType: path.endsWith('.svg') ? 'image/svg+xml' : 'image/png',
      base64: 'aW1hZ2U=',
    }))
    const result = await prepareKnowledgeDocumentHtml(
      [
        ':::gallery size=88 columns=6',
        '![App tile](assets/tile.svg)',
        '![Screenshot](assets/screenshot.png)',
        ':::',
      ].join('\n'),
      '/wiki/brand.knowledge',
      readBinary,
    )
    const container = document.createElement('div')
    container.innerHTML = result.html
    const gallery = container.querySelector<HTMLElement>('[data-knowledge-gallery]')!
    expect(gallery.dataset.thumbnailSize).toBe('88')
    expect(gallery.dataset.galleryColumns).toBe('6')
    expect(gallery.querySelectorAll('img[data-knowledge-image-preview]')).toHaveLength(2)
    expect(readBinary).toHaveBeenCalledTimes(2)
    expect(result.imageFailures).toEqual([])
  })

  it('reports a failed asset by its package-relative path without hiding the page', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const readBinary = vi.fn(async (path: string) => {
      if (path.endsWith('missing.svg')) throw new Error('File not found')
      return { mimeType: 'image/png', base64: 'iVBORw==' }
    })

    const result = await prepareKnowledgeDocumentHtml(
      [
        'Page text remains visible.',
        '',
        '![Missing tile](assets/missing.svg)',
        '',
        '![Available screenshot](assets/screenshot.png)',
      ].join('\n'),
      '/wiki/brand.knowledge',
      readBinary,
    )

    expect(result.html).toContain('Page text remains visible.')
    expect(result.html).toContain('src="assets/missing.svg"')
    expect(result.html).toContain('data:image/png;base64,iVBORw==')
    expect(result.imageFailures).toEqual([
      { path: 'assets/missing.svg', message: 'File not found' },
    ])
    expect(warning).toHaveBeenCalledWith(
      '[PureKnowledge] Could not load inline image "assets/missing.svg": File not found',
    )
    const container = document.createElement('div')
    container.innerHTML = result.html
    expect(
      container
        .querySelector('img[src="assets/missing.svg"]')
        ?.hasAttribute('data-knowledge-image-preview'),
    ).toBe(false)
  })
})
