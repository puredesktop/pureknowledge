import {
  absoluteCollectionAssetPath,
  COLLECTION_ASSET_SRC_ATTR,
  isDisplayableAbsoluteSource,
  type ReadCollectionBinary,
} from '@purescience/platform-ui/bridge/collectionDocumentHtml'
import {
  knowledgeMarkdownToHtml,
  upgradeLegacyKnowledgeGalleries,
} from './knowledgeGallery'
import {
  hasDangerousSvgContent,
  isAbsolutePathInsidePackage,
  resolveSafePackageRelativeAssetPath,
  sanitizeHtml,
} from './sanitizeHtml'

export interface KnowledgeImageLoadFailure {
  path: string
  message: string
}

export interface PreparedKnowledgeDocument {
  html: string
  imageFailures: KnowledgeImageLoadFailure[]
}

export interface KnowledgeImagePreview {
  src: string
  alt: string
  path: string
}

/** The shell streams package files to app frames through this scheme. */
export const SHELL_FILE_URL_PREFIX = 'purescience-fs://'

const ALLOWED_INLINE_IMAGE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
])

function isShownSource(src: string): boolean {
  return isDisplayableAbsoluteSource(src)
}

function isPreviewableImage(image: Element): boolean {
  const src = image.getAttribute('src')?.trim() ?? ''
  if (!src) return false
  if (isDisplayableAbsoluteSource(src)) return true
  return (
    src.startsWith(SHELL_FILE_URL_PREFIX) &&
    Boolean(image.getAttribute(COLLECTION_ASSET_SRC_ATTR)?.trim())
  )
}

function makeImagesPreviewable(html: string): string {
  if (!html.trim()) return html
  const document = new DOMParser().parseFromString(html, 'text/html')
  let changed = false
  for (const image of Array.from(document.querySelectorAll('img[src]'))) {
    if (!isPreviewableImage(image)) continue
    const alt = image.getAttribute('alt')?.trim()
    image.setAttribute('data-knowledge-image-preview', '')
    image.setAttribute('role', 'button')
    image.setAttribute('tabindex', '0')
    image.setAttribute(
      'aria-label',
      alt ? `Open ${alt} larger` : 'Open image larger',
    )
    changed = true
  }
  return changed ? document.body.innerHTML : html
}

export function readKnowledgeImagePreview(
  target: EventTarget | null,
): KnowledgeImagePreview | null {
  if (!(target instanceof Element)) return null
  const image = target.closest<HTMLImageElement>(
    'img[data-knowledge-image-preview]',
  )
  if (!image) return null
  const src = image.currentSrc || image.getAttribute('src') || ''
  if (!src) return null
  return {
    src,
    alt: image.getAttribute('alt')?.trim() || 'Inline image',
    path:
      image.getAttribute('data-writer-asset-src')?.trim() ||
      image.getAttribute('src')?.trim() ||
      '',
  }
}

/** A shell URL for a package file; throws when the file is missing. */
export type FileUrlFor = (absolutePath: string) => Promise<string>

/**
 * Prepare page Markdown for display with images served by URL.
 *
 * Inlining images copied every file through the bridge as base64 text and
 * parsed the result several times: a page of 70 photographs was tens of
 * megabytes of string work before the first paint. A URL is a few bytes, the
 * browser streams the file itself, and `loading="lazy"` fetches a picture
 * only when it scrolls near. The relative path stays on the image so saving
 * writes it back unchanged.
 */
function decodeBase64Safe(base64: string): string | null {
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

export async function prepareKnowledgeDocumentHtmlWithUrls(
  markdown: string,
  packagePath: string,
  fileUrlFor: FileUrlFor,
): Promise<PreparedKnowledgeDocument> {
  const failures = new Map<string, KnowledgeImageLoadFailure>()
  const html = sanitizeHtml(
    upgradeLegacyKnowledgeGalleries(knowledgeMarkdownToHtml(markdown)),
  )
  if (!html.trim() || !packagePath.trim()) return { html: makeImagesPreviewable(html), imageFailures: [] }
  const document = new DOMParser().parseFromString(html, 'text/html')
  const images = Array.from(document.querySelectorAll('img'))
  await Promise.all(images.map(async image => {
    const src = image.getAttribute('src')?.trim()
    if (!src || isShownSource(src)) return
    const relative = resolveSafePackageRelativeAssetPath(src, packagePath)
    if (!relative) return
    const absolutePath = absoluteCollectionAssetPath(packagePath, relative)
    if (!isAbsolutePathInsidePackage(absolutePath, packagePath)) return
    try {
      const url = await fileUrlFor(absolutePath)
      image.setAttribute('src', url)
      image.setAttribute(COLLECTION_ASSET_SRC_ATTR, relative)
      image.setAttribute('loading', 'lazy')
      image.setAttribute('decoding', 'async')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!failures.has(relative)) {
        failures.set(relative, { path: relative, message })
        console.warn(`[PureKnowledge] Could not load inline image "${relative}": ${message}`)
      }
    }
  }))
  return {
    html: makeImagesPreviewable(document.body.innerHTML),
    imageFailures: [...failures.values()],
  }
}

/**
 * Prepare page Markdown for display with images inlined as data URLs. Kept
 * for frames where the shell's file URLs cannot be shown.
 */
export async function prepareKnowledgeDocumentHtml(
  markdown: string,
  packagePath: string,
  readBinary: ReadCollectionBinary,
): Promise<PreparedKnowledgeDocument> {
  const failures = new Map<string, KnowledgeImageLoadFailure>()
  const html = sanitizeHtml(
    upgradeLegacyKnowledgeGalleries(knowledgeMarkdownToHtml(markdown)),
  )
  if (!html.trim() || !packagePath.trim()) {
    return { html: makeImagesPreviewable(html), imageFailures: [] }
  }
  const document = new DOMParser().parseFromString(html, 'text/html')
  const images = Array.from(document.querySelectorAll('img'))
  for (const image of images) {
    const src = image.getAttribute('src')?.trim()
    if (!src || isShownSource(src)) continue
    const relative = resolveSafePackageRelativeAssetPath(src, packagePath)
    if (!relative) continue
    const absolutePath = absoluteCollectionAssetPath(packagePath, relative)
    if (!isAbsolutePathInsidePackage(absolutePath, packagePath)) continue
    try {
      const result = await readBinary(absolutePath)
      const normalizedMime = result.mimeType.trim().toLowerCase()
      if (!ALLOWED_INLINE_IMAGE_MIME_TYPES.has(normalizedMime)) {
        throw new Error(`Unsupported inline image MIME type "${result.mimeType}"`)
      }
      if (normalizedMime === 'image/svg+xml') {
        const decodedSvg = decodeBase64Safe(result.base64)
        if (decodedSvg === null || hasDangerousSvgContent(decodedSvg)) {
          throw new Error('SVG asset contains active, malformed, or external content')
        }
      }
      image.setAttribute('src', `data:${normalizedMime};base64,${result.base64}`)
      image.setAttribute(COLLECTION_ASSET_SRC_ATTR, relative)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!failures.has(relative)) {
        failures.set(relative, { path: relative, message })
        console.warn(
          `[PureKnowledge] Could not load inline image "${relative}": ${message}`,
        )
      }
    }
  }
  return {
    html: makeImagesPreviewable(document.body.innerHTML),
    imageFailures: [...failures.values()],
  }
}
