import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@purescience/platform-ui/bridge/fs', () => ({
  readPlatformFileBinary: vi.fn(),
  writePlatformFileBinary: vi.fn(async () => ({ ok: true })),
}))
vi.mock('@purescience/platform-ui/bridge/assets', () => ({
  updateCollectionAsset: vi.fn(async () => ({})),
}))

import {
  readPlatformFileBinary,
  writePlatformFileBinary,
} from '@purescience/platform-ui/bridge/fs'
import { updateCollectionAsset } from '@purescience/platform-ui/bridge/assets'
import { importKnowledgeImages } from './knowledgeAssets'

describe('importKnowledgeImages', () => {
  beforeEach(() => {
    vi.mocked(readPlatformFileBinary).mockReset()
    vi.mocked(writePlatformFileBinary).mockClear()
    vi.mocked(updateCollectionAsset).mockClear()
  })

  it('copies a bulk batch into assets and returns portable markdown', async () => {
    vi.mocked(readPlatformFileBinary)
      .mockResolvedValueOnce({ path: '/Brand/Pure logo.svg', mimeType: 'image/svg+xml', base64: 'PHN2Zz4=', truncated: false, byteLength: 5 })
      .mockResolvedValueOnce({ path: '/Brand/slide.png', mimeType: 'image/png', base64: 'iVBORw==', truncated: false, byteLength: 6 })

    const imported = await importKnowledgeImages('/wiki/brand.knowledge', [
      { sourcePath: '/Brand/Pure logo.svg', alt: 'Pure [logo]' },
      { sourcePath: '/Brand/slide.png', alt: 'Pitch slide' },
    ])

    expect(imported).toHaveLength(2)
    expect(imported[0]?.relativePath).toMatch(/^assets\/.+Pure-logo.+\.svg$/)
    expect(imported[0]?.markdown).toContain('![Pure \\[logo\\]](assets/')
    expect(imported[1]?.relativePath).toMatch(/^assets\/.+slide.+\.png$/)
    expect(writePlatformFileBinary).toHaveBeenCalledTimes(2)
    expect(updateCollectionAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        collectionPath: '/wiki/brand.knowledge',
        relativePath: imported[0]?.relativePath,
        label: 'Pure [logo]',
      }),
    )
  })

  it('validates the complete batch before writing destinations', async () => {
    vi.mocked(readPlatformFileBinary)
      .mockResolvedValueOnce({ path: '/Brand/logo.png', mimeType: 'image/png', base64: 'iVBORw==', truncated: false, byteLength: 6 })
      .mockResolvedValueOnce({ path: '/Brand/guide.pdf', mimeType: 'application/pdf', base64: 'JVBERi0=', truncated: false, byteLength: 6 })

    await expect(
      importKnowledgeImages('/wiki/brand.knowledge', [
        { sourcePath: '/Brand/logo.png' },
        { sourcePath: '/Brand/guide.pdf' },
      ]),
    ).rejects.toThrow('Unsupported image')
    expect(writePlatformFileBinary).not.toHaveBeenCalled()
  })
  it('rejects oversized batches before writing any files', async () => {
    vi.mocked(readPlatformFileBinary).mockResolvedValue({ mimeType: 'image/png', base64: 'A'.repeat(25 * 1024 * 1024) })
    await expect(importKnowledgeImages('/wiki/gallery.knowledge',
      Array.from({ length: 5 }, (_, index) => ({ sourcePath: `/images/${index}.png` })),
    )).rejects.toThrow('batch is too large')
    expect(writePlatformFileBinary).not.toHaveBeenCalled()
  })

})
