import { readPlatformFileBinary, writePlatformFileBinary } from '@purescience/platform-ui/bridge/fs'
import { updateCollectionAsset } from '@purescience/platform-ui/bridge/assets'
import { uint8ArrayToBase64 } from '@purescience/platform-editor/insertCollectionImage.ts'
import { buildPastedFigureRelativePath, normalizeCollectionImageMimeType } from '@purescience/platform-ui/bridge/collectionImagePaste'
import { readAssetTransfer } from '@purescience/platform-editor/assetTransfer.ts'
import { hasDangerousSvgContent, normalizeCssForSecurityCheck } from '../lib/sanitizeHtml'

const MAX_IMPORTED_IMAGE_BYTES = 24 * 1024 * 1024
const MAX_BATCH_BASE64_CHARS = 96 * 1024 * 1024

function decodeBase64ToText(base64: string): string | null {
  try {
    const clean = base64.replace(/\s+/g, '')
    if (!clean || clean.length % 4 === 1 || !/^[A-Za-z0-9+/=]+$/.test(clean)) {
      return null
    }
    if (typeof atob === 'function') {
      const raw = atob(clean)
      const bytes = new Uint8Array(raw.length)
      for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i)
      return new TextDecoder().decode(bytes)
    }
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(clean, 'base64').toString('utf8')
    }
    return null
  } catch {
    return null
  }
}

const DISALLOWED_SVG_LOCAL_NAMES = new Set([
  'script',
  'foreignobject',
  'iframe',
  'object',
  'embed',
  'animate',
  'animatetransform',
  'animatemotion',
  'animatecolor',
  'set',
  'handler',
  'discard',
  'mpath',
])

function assertSafeSvgImport(name: string, base64: string): void {
  const svgText = decodeBase64ToText(base64)
  if (svgText === null) {
    throw new Error(`The SVG asset "${name}" could not be decoded safely.`)
  }
  if (hasDangerousSvgContent(svgText)) {
    throw new Error(`The SVG asset "${name}" contains unsupported active or external content.`)
  }
  if (typeof DOMParser !== 'undefined') {
    const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml')
    if (
      doc.documentElement?.localName.toLowerCase() !== 'svg' ||
      doc.querySelector('parsererror')
    ) {
      throw new Error(`The SVG asset "${name}" is malformed or not a valid SVG document.`)
    }
    for (const node of Array.from(doc.querySelectorAll('*'))) {
      const local = node.localName.toLowerCase()
      if (DISALLOWED_SVG_LOCAL_NAMES.has(local)) {
        throw new Error(`The SVG asset "${name}" contains unsupported active content.`)
      }
      for (const attr of Array.from(node.attributes)) {
        const attrLocal = attr.localName.toLowerCase()
        const attrName = attr.name.toLowerCase()
        const normalizedCss = normalizeCssForSecurityCheck(attr.value)
        if (
          attrLocal.startsWith('on') ||
          attrName.startsWith('on') ||
          (attrLocal === 'href' && attr.value.trim() && !attr.value.trim().startsWith('#')) ||
          /(?:url\s*\(\s*['"]?(?!#)|@import)/i.test(normalizedCss)
        ) {
          throw new Error(`The SVG asset "${name}" contains external or active content.`)
        }
      }
      if (local === 'style') {
        const normalizedStyle = normalizeCssForSecurityCheck(node.textContent ?? '')
        if (/(?:url\s*\(\s*['"]?(?!#)|@import)/i.test(normalizedStyle)) {
          throw new Error(`The SVG asset "${name}" contains external styles.`)
        }
      }
    }
  }
}

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
  const normalizedPackagePath = packagePath.replace(/\/+$/, '')
  if (!normalizedPackagePath.endsWith('.knowledge')) {
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
    if (mimeType === 'image/svg+xml') {
      assertSafeSvgImport(name, binary.base64)
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
    const absolutePath = `${normalizedPackagePath}/${relativePath}`
    const alt = image.alt?.trim() || image.name.replace(/\.[^.]+$/, '')
    await writePlatformFileBinary(absolutePath, image.base64)
    await updateCollectionAsset({
      collectionPath: normalizedPackagePath,
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

export async function saveKnowledgeImage(
  packagePath: string,
  image: ReturnType<typeof readAssetTransfer>,
): Promise<{
  relativePath: string
  absolutePath: string
  dataUrl: string
  mimeType?: string
}> {
  const normalizedPackagePath = packagePath.replace(/\/+$/, '')
  if (!normalizedPackagePath.endsWith('.knowledge')) throw new Error('Open a knowledge package before dropping images.')
  const mimeType = normalizeCollectionImageMimeType(image.mimeType, image.name)
  if (!mimeType) throw new Error('Supported images are PNG, JPEG, GIF, WebP, and SVG.')
  if (image.bytes.byteLength > MAX_IMPORTED_IMAGE_BYTES) throw new Error('The image exceeds the 24 MB limit.')
  const base64 = uint8ArrayToBase64(image.bytes)
  if (mimeType === 'image/svg+xml') {
    assertSafeSvgImport(image.name, base64)
    if (typeof DOMParser !== 'undefined') {
      // Reuse the editor's active-content checks for images chosen from the UI.
      readAssetTransfer(JSON.stringify({
        version: 1,
        name: image.name,
        alt: image.alt,
        caption: image.caption,
        dataUrl: `data:${mimeType};base64,${base64}`,
      }))
    }
  }
  const relativePath = buildPastedFigureRelativePath('assets', `${crypto.randomUUID()}-${image.name}`, mimeType)
  const absolutePath = `${normalizedPackagePath}/${relativePath}`
  await writePlatformFileBinary(absolutePath, base64)
  await updateCollectionAsset({ collectionPath: normalizedPackagePath, relativePath, label: image.alt || image.name, caption: image.caption ?? '' })
  return { relativePath, absolutePath, mimeType, dataUrl: `data:${mimeType};base64,${base64}` }
}
