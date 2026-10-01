import {
  absoluteCollectionAssetPath,
  COLLECTION_ASSET_SRC_ATTR,
  isDisplayableAbsoluteSource,
  prepareCollectionDocumentHtml,
  relativeAssetSrcForHtml,
  relativizeCollectionAssetPath,
  type ReadCollectionBinary,
} from '@purescience/platform-ui/bridge/collectionDocumentHtml'
import {
  knowledgeMarkdownToHtml,
  upgradeLegacyKnowledgeGalleries,
} from './knowledgeGallery'

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

function isShownSource(src: string): boolean {
  return isDisplayableAbsoluteSource(src) || src.startsWith(SHELL_FILE_URL_PREFIX)
}

function makeImagesPreviewable(html: string): string {
  if (!html.trim()) return html
  const document = new DOMParser().parseFromString(html, 'text/html')
  let changed = false
  for (const image of Array.from(document.querySelectorAll('img[src]'))) {
    const src = image.getAttribute('src')?.trim() ?? ''
    if (!isShownSource(src)) continue
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
export async function prepareKnowledgeDocumentHtmlWithUrls(
  markdown: string,
  packagePath: string,
  fileUrlFor: FileUrlFor,
): Promise<PreparedKnowledgeDocument> {
  const failures = new Map<string, KnowledgeImageLoadFailure>()
  const html = upgradeLegacyKnowledgeGalleries(knowledgeMarkdownToHtml(markdown))
  if (!html.trim() || !packagePath.trim()) return { html: makeImagesPreviewable(html), imageFailures: [] }
  const document = new DOMParser().parseFromString(html, 'text/html')
  const images = Array.from(document.querySelectorAll('img'))
  await Promise.all(images.map(async image => {
    const src = image.getAttribute('src')?.trim()
    if (!src || isShownSource(src)) return
    const relative = relativeAssetSrcForHtml(src, packagePath)
    if (!relative) return
    try {
      const url = await fileUrlFor(absoluteCollectionAssetPath(packagePath, relative))
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
  const reportingReader: ReadCollectionBinary = async absolutePath => {
    try {
      return await readBinary(absolutePath)
    } catch (error) {
      const path =
        relativizeCollectionAssetPath(absolutePath, packagePath) ?? absolutePath
      const message = error instanceof Error ? error.message : String(error)
      if (!failures.has(path)) {
        const failure = { path, message }
        failures.set(path, failure)
        console.warn(
          `[PureKnowledge] Could not load inline image "${path}": ${message}`,
        )
      }
      throw error
    }
  }

  const html = await prepareCollectionDocumentHtml(
    upgradeLegacyKnowledgeGalleries(knowledgeMarkdownToHtml(markdown)),
    packagePath,
    reportingReader,
  )
  return {
    html: makeImagesPreviewable(html),
    imageFailures: [...failures.values()],
  }
}
