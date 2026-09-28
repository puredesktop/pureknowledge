import {
  isDisplayableAbsoluteSource,
  prepareCollectionDocumentHtml,
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

function makeImagesPreviewable(html: string): string {
  if (!html.trim()) return html
  const document = new DOMParser().parseFromString(html, 'text/html')
  let changed = false
  for (const image of Array.from(document.querySelectorAll('img[src]'))) {
    const src = image.getAttribute('src')?.trim() ?? ''
    if (!isDisplayableAbsoluteSource(src)) continue
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

/**
 * Prepare page Markdown for display while retaining the asset failures that
 * the shared collection renderer deliberately tolerates.
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
