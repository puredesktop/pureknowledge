import { readPlatformFileBinary, writePlatformFileBinary } from '@purescience/platform-ui/bridge/fs'
import { updateCollectionAsset } from '@purescience/platform-ui/bridge/assets'
import { uint8ArrayToBase64 } from '@purescience/platform-editor/insertCollectionImage.ts'
import { buildPastedFigureRelativePath, normalizeCollectionImageMimeType } from '@purescience/platform-ui/bridge/collectionImagePaste'
import { readAssetTransfer } from '@purescience/platform-editor/assetTransfer.ts'

const MAX_IMPORTED_IMAGE_BYTES = 24 * 1024 * 1024
const MAX_BATCH_BASE64_CHARS = 96 * 1024 * 1024

export interface KnowledgeImageImport {
  sourcePath: string
  alt?: string
}

export interface ImportedKnowledgeImage {
  sourcePath: string
  relativePath: string
  absolutePath: string
  alt: string
  markdown: string
}

function sourceName(path: string): string {
  return path.replace(/\\/g, '/').split('/').pop() || 'image'
}

function escapeMarkdownAlt(value: string): string {
  return value.replace(/[\\\[\]]/g, character => `\\${character}`)
}

/** Copy local images into a knowledge package and return portable Markdown. */
export async function importKnowledgeImages(
  packagePath: string,
  images: KnowledgeImageImport[],
): Promise<ImportedKnowledgeImage[]> {
  if (!packagePath.endsWith('.knowledge')) {
    throw new Error('Open a knowledge package before importing images.')
  }

  // Read and validate the complete batch before writing any destination file.
  const prepared: Array<KnowledgeImageImport & {
    name: string
    mimeType: string
    base64: string
  }> = []
  let batchChars = 0
  for (const image of images) {
    const name = sourceName(image.sourcePath)
    const binary = await readPlatformFileBinary(
      image.sourcePath,
      MAX_IMPORTED_IMAGE_BYTES,
    )
    if (binary.truncated) {
      throw new Error(
        `Image "${image.sourcePath}" exceeds the 24 MB import limit.`,
      )
    }
    batchChars += binary.base64.length
    if (batchChars > MAX_BATCH_BASE64_CHARS) {
      throw new Error('This image batch is too large. Import fewer images at a time (about 72 MB total).')
    }
    const mimeType = normalizeCollectionImageMimeType(binary.mimeType, name)
    if (!mimeType) {
      throw new Error(
        `Unsupported image "${image.sourcePath}". Supported: PNG, JPEG, GIF, WebP, SVG.`,
      )
    }
    prepared.push({ ...image, name, mimeType, base64: binary.base64 })
  }

  const imported: ImportedKnowledgeImage[] = []
  for (const [index, image] of prepared.entries()) {
    const relativePath = buildPastedFigureRelativePath(
      'assets',
      `${crypto.randomUUID()}-${image.name}`,
      image.mimeType,
      Date.now() + index,
    )
    const absolutePath = `${packagePath.replace(/\/+$/, '')}/${relativePath}`
    const alt = image.alt?.trim() || image.name.replace(/\.[^.]+$/, '')
    await writePlatformFileBinary(absolutePath, image.base64)
    await updateCollectionAsset({
      collectionPath: packagePath,
      relativePath,
      label: alt,
      caption: '',
    })
    imported.push({
      sourcePath: image.sourcePath,
      relativePath,
      absolutePath,
      alt,
      markdown: `![${escapeMarkdownAlt(alt)}](${relativePath})`,
    })
  }
  return imported
}

export async function saveKnowledgeImage(packagePath: string, image: ReturnType<typeof readAssetTransfer>) {
  if (!packagePath.endsWith('.knowledge')) throw new Error('Open a knowledge package before dropping images.')
  const mimeType = normalizeCollectionImageMimeType(image.mimeType, image.name)
  if (!mimeType) throw new Error('Supported images are PNG, JPEG, GIF, WebP, and SVG.')
  if (image.bytes.byteLength > MAX_IMPORTED_IMAGE_BYTES) throw new Error('The image exceeds the 24 MB limit.')
  if (mimeType === 'image/svg+xml') {
    // Reuse the editor's active-content checks for images chosen from the UI.
    readAssetTransfer(JSON.stringify({
      version: 1,
      name: image.name,
      alt: image.alt,
      caption: image.caption,
      dataUrl: `data:${mimeType};base64,${uint8ArrayToBase64(image.bytes)}`,
    }))
  }
  const relativePath = buildPastedFigureRelativePath('assets', `${crypto.randomUUID()}-${image.name}`, mimeType)
  const absolutePath = `${packagePath}/${relativePath}`
  const base64 = uint8ArrayToBase64(image.bytes)
  await writePlatformFileBinary(absolutePath,base64)
  await updateCollectionAsset({collectionPath:packagePath,relativePath,label:image.alt || image.name,caption:image.caption ?? ''})
  return {relativePath,absolutePath,dataUrl:`data:${image.mimeType};base64,${base64}`}
}
