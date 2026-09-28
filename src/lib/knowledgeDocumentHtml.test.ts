// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { prepareKnowledgeDocumentHtml } from './knowledgeDocumentHtml'

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
  })
})
