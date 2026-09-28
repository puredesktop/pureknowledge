import { Figure, toHtml, toMd } from '@purescience/platform-editor'
import { normalizeCollectionDocumentHtml } from '@purescience/platform-ui/bridge/collectionDocumentHtml'

const DEFAULT_SIZE = 96
const MIN_SIZE = 48
const MAX_SIZE = 320
const MIN_COLUMNS = 1
const MAX_COLUMNS = 12

interface GalleryOptions { size: number; columns: number | null }
export type GalleryImageBackground = 'transparent' | 'light' | 'dark' | 'checkerboard'
export interface GalleryImage { alt: string; src: string; background?: GalleryImageBackground }

function integer(value: string | null | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback
}

function parseOptions(source = ''): GalleryOptions {
  const read = (name: string): string | undefined =>
    new RegExp(`(?:^|\\s)${name}=(\\d+)(?=\\s|$)`, 'i').exec(source)?.[1]
  const columns = read('columns')
  return {
    size: integer(read('size'), DEFAULT_SIZE, MIN_SIZE, MAX_SIZE),
    columns: columns ? integer(columns, MIN_COLUMNS, MIN_COLUMNS, MAX_COLUMNS) : null,
  }
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function escapeMarkdownAlt(value: string): string {
  return value.replace(/([\\\]])/g, '\\$1')
}

function parseImageLine(line: string): GalleryImage | null {
  const match = /^\s*!\[((?:\\.|[^\]])*)\]\((\S+?)(?:\s+["'].*["'])?\)(?:\s+\{background=(transparent|light|dark|checkerboard)\})?\s*$/.exec(line)
  return match ? {
    alt: match[1].replace(/\\([\\\]])/g, '$1'),
    src: match[2],
    background: match[3] as GalleryImageBackground | undefined,
  } : null
}

function imageMarkdown(image: GalleryImage): string {
  const background = image.background && image.background !== 'transparent'
    ? ` {background=${image.background}}`
    : ''
  return `![${escapeMarkdownAlt(image.alt)}](${image.src})${background}`
}

function galleryStyle(options: GalleryOptions): string {
  return `--knowledge-gallery-size:${options.size}px;${options.columns === null ? '' : `--knowledge-gallery-columns:${options.columns};`}`
}

function galleryHtml(images: GalleryImage[], options: GalleryOptions): string {
  const columns = options.columns === null ? '' : ` data-gallery-columns="${options.columns}"`
  const figures = images.map(({ alt, src, background }) => {
    const safeAlt = escapeHtml(alt)
    const surface = background && background !== 'transparent'
      ? ` data-gallery-background="${background}"`
      : ''
    return `<figure${surface}><img src="${escapeHtml(src)}" alt="${safeAlt}"><figcaption>${safeAlt}</figcaption></figure>`
  }).join('')
  return `<div data-knowledge-gallery="" data-thumbnail-size="${options.size}"${columns} style="${galleryStyle(options)}">${figures}</div>`
}

/** Convert durable gallery directives before the ordinary Markdown renderer runs. */
export function knowledgeMarkdownToHtml(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  const output: string[] = []
  let index = 0
  while (index < lines.length) {
    const fence = /^\s*(`{3,}|~{3,})/.exec(lines[index])?.[1]
    if (fence) {
      const closesFence = new RegExp(`^\\s*${fence[0]}{${fence.length},}\\s*$`)
      output.push(lines[index])
      index += 1
      while (index < lines.length) {
        output.push(lines[index])
        const closed = closesFence.test(lines[index])
        index += 1
        if (closed) break
      }
      continue
    }
    const opening = /^\s*:::gallery(?:\s+(.*?))?\s*$/.exec(lines[index])
    if (!opening) { output.push(lines[index]); index += 1; continue }
    const relativeClosing = lines.slice(index + 1).findIndex(line => /^\s*:::\s*$/.test(line))
    if (relativeClosing < 0) { output.push(lines[index]); index += 1; continue }
    const closing = index + 1 + relativeClosing
    const images = lines.slice(index + 1, closing).filter(line => line.trim()).map(parseImageLine)
    if (images.length === 0 || images.some(image => image === null)) {
      output.push(...lines.slice(index, closing + 1)); index = closing + 1; continue
    }
    output.push('', galleryHtml(images as GalleryImage[], parseOptions(opening[1])), '')
    index = closing + 1
  }
  return toHtml(output.join('\n'))
}

function inferLegacyOptions(element: HTMLElement): GalleryOptions {
  const style = element.getAttribute('style') ?? ''
  const size = element.querySelector('img[width]')?.getAttribute('width') ?? /minmax\(\s*(\d+)px/i.exec(style)?.[1]
  const columns = /repeat\(\s*(\d+)\s*,/i.exec(style)?.[1]
  return {
    size: integer(size, DEFAULT_SIZE, MIN_SIZE, MAX_SIZE),
    columns: columns ? integer(columns, MIN_COLUMNS, MIN_COLUMNS, MAX_COLUMNS) : null,
  }
}

/** Tag the raw-HTML grids used before gallery directives existed for safe migration. */
export function upgradeLegacyKnowledgeGalleries(html: string): string {
  if (!html.trim()) return html
  const document = new DOMParser().parseFromString(html, 'text/html')
  let changed = false
  for (const element of Array.from(document.querySelectorAll<HTMLElement>('div[style]'))) {
    if (element.hasAttribute('data-knowledge-gallery')) continue
    const style = element.getAttribute('style') ?? ''
    const children = Array.from(element.children)
    if (!/(?:^|;)\s*display\s*:\s*grid(?:;|$)/i.test(style) || children.length === 0) continue
    if (children.some(child => child.tagName !== 'FIGURE' || !child.querySelector('img[src]'))) continue
    const options = inferLegacyOptions(element)
    element.setAttribute('data-knowledge-gallery', '')
    element.setAttribute('data-thumbnail-size', String(options.size))
    if (options.columns !== null) element.setAttribute('data-gallery-columns', String(options.columns))
    element.setAttribute('style', galleryStyle(options))
    changed = true
  }
  return changed ? document.body.innerHTML : html
}

function readOptions(element: HTMLElement): GalleryOptions {
  return {
    size: integer(element.getAttribute('data-thumbnail-size'), DEFAULT_SIZE, MIN_SIZE, MAX_SIZE),
    columns: element.hasAttribute('data-gallery-columns')
      ? integer(element.getAttribute('data-gallery-columns'), MIN_COLUMNS, MIN_COLUMNS, MAX_COLUMNS)
      : null,
  }
}

function galleryMarkdown(element: HTMLElement): string {
  const options = readOptions(element)
  const attributes = [`size=${options.size}`]
  if (options.columns !== null) attributes.push(`columns=${options.columns}`)
  const images = Array.from(element.querySelectorAll('img[src]')).map(image => {
    const alt = image.closest('figure')?.querySelector('figcaption')?.textContent?.trim() || image.getAttribute('alt') || ''
    const background = image.closest('figure')?.getAttribute('data-gallery-background') as GalleryImageBackground | null
    return imageMarkdown({ alt, src: image.getAttribute('src') ?? '', background: background ?? undefined })
  })
  return `:::gallery ${attributes.join(' ')}\n${images.join('\n')}\n:::`
}

/** Serialize editor HTML without allowing the generic converter to flatten galleries. */
export function knowledgeHtmlToMarkdown(html: string, packagePath: string): string {
  const normalized = normalizeCollectionDocumentHtml(html, packagePath)
  if (!normalized.trim()) return ''
  const document = new DOMParser().parseFromString(normalized, 'text/html')
  const replacements = new Map<string, string>()
  Array.from(document.querySelectorAll<HTMLElement>('[data-knowledge-gallery]')).forEach((gallery, index) => {
    const token = `PUREKNOWLEDGEGALLERYBLOCK${index}TOKEN`
    replacements.set(token, galleryMarkdown(gallery))
    const marker = document.createElement('p')
    marker.textContent = token
    gallery.replaceWith(marker)
  })
  let markdown = toMd(document.body.innerHTML)
  for (const [token, gallery] of replacements) markdown = markdown.replace(token, gallery)
  return markdown
}

function changeGallery(
  markdown: string,
  galleryIndex: number,
  change: (images: GalleryImage[]) => GalleryImage[],
): string {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  let found = -1
  for (let start = 0; start < lines.length; start += 1) {
    const fence = /^\s*(`{3,}|~{3,})/.exec(lines[start])?.[1]
    if (fence) {
      const closesFence = new RegExp(`^\\s*${fence[0]}{${fence.length},}\\s*$`)
      while (start + 1 < lines.length) {
        start += 1
        if (closesFence.test(lines[start])) break
      }
      continue
    }
    if (!/^\s*:::gallery(?:\s+.*?)?\s*$/.test(lines[start])) continue
    found += 1
    const relativeEnd = lines.slice(start + 1).findIndex(line => /^\s*:::\s*$/.test(line))
    if (relativeEnd < 0) return markdown
    const end = start + 1 + relativeEnd
    if (found !== galleryIndex) { start = end; continue }
    const images = lines.slice(start + 1, end).filter(line => line.trim()).map(parseImageLine)
    if (images.some(image => image === null)) return markdown
    const nextImages = change(images as GalleryImage[])
    if (nextImages.length === 0) return [...lines.slice(0, start), ...lines.slice(end + 1)].join('\n').replace(/\n{3,}/g, '\n\n')
    return [...lines.slice(0, start + 1), ...nextImages.map(imageMarkdown), ...lines.slice(end)].join('\n')
  }
  return markdown
}

export function appendKnowledgeGalleryImages(markdown: string, galleryIndex: number, images: GalleryImage[]): string {
  return changeGallery(markdown, galleryIndex, existing => [...existing, ...images])
}

export function removeKnowledgeGalleryImage(markdown: string, galleryIndex: number, imageIndex: number): string {
  return changeGallery(markdown, galleryIndex, images => images.filter((_image, index) => index !== imageIndex))
}

export function setKnowledgeGalleryImageBackground(
  markdown: string,
  galleryIndex: number,
  imageIndex: number,
  background: GalleryImageBackground,
): string {
  return changeGallery(markdown, galleryIndex, images => images.map((image, index) =>
    index === imageIndex ? { ...image, background } : image,
  ))
}

/** Add lightweight management buttons to reading HTML; editor HTML stays semantic. */
export function addKnowledgeGalleryControls(html: string): string {
  if (!html.trim()) return html
  const document = new DOMParser().parseFromString(html, 'text/html')
  const galleries = Array.from(document.querySelectorAll<HTMLElement>('[data-knowledge-gallery]'))
  for (const [galleryIndex, gallery] of galleries.entries()) {
    const toolbar = document.createElement('div')
    toolbar.className = 'knowledge-gallery-toolbar'
    toolbar.innerHTML = `<button type="button" data-gallery-add="${galleryIndex}">Add images</button>`
    gallery.prepend(toolbar)
    Array.from(gallery.querySelectorAll<HTMLElement>(':scope > figure')).forEach((figure, imageIndex) => {
      const background = (figure.dataset.galleryBackground ?? 'transparent') as GalleryImageBackground
      const backgroundLabel = background[0].toUpperCase() + background.slice(1)
      const controls = document.createElement('div')
      controls.className = 'knowledge-gallery-image-controls'
      controls.innerHTML = [
        `<button type="button" data-gallery-background="${galleryIndex}:${imageIndex}" data-background-value="${background}" title="Change background · ${backgroundLabel}" aria-label="Change ${escapeHtml(figure.querySelector('img')?.getAttribute('alt') || 'image')} background; currently ${backgroundLabel}"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="M12 3a9 9 0 0 1 0 18Z"></path></svg></button>`,
        `<button type="button" data-gallery-download="${galleryIndex}:${imageIndex}" title="Download image" aria-label="Download ${escapeHtml(figure.querySelector('img')?.getAttribute('alt') || 'image')}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5M5 21h14"></path></svg></button>`,
        `<button type="button" class="knowledge-gallery-remove" data-gallery-remove="${galleryIndex}:${imageIndex}" title="Remove from gallery" aria-label="Remove ${escapeHtml(figure.querySelector('img')?.getAttribute('alt') || 'image')} from gallery"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"></path></svg></button>`,
      ].join('')
      figure.append(controls)
    })
  }
  return galleries.length ? document.body.innerHTML : html
}

export const KnowledgeFigure = Figure.extend({
  name: 'figure',
  addAttributes() {
    return {
      ...this.parent?.(),
      galleryBackground: {
        default: null,
        parseHTML: element => element.getAttribute('data-gallery-background'),
        renderHTML: attributes => attributes.galleryBackground
          ? { 'data-gallery-background': attributes.galleryBackground }
          : {},
      },
    }
  },
})

/** A real editor node keeps gallery structure and sizing through HTML round-trips. */
export const KnowledgeGallery = Figure.extend({
  name: 'knowledgeGallery',
  group: 'block',
  content: 'figure+',
  defining: true,
  isolating: true,
  draggable: false,
  addAttributes() {
    return {
      thumbnailSize: { default: DEFAULT_SIZE, parseHTML: element => readOptions(element).size, rendered: false },
      columns: { default: null, parseHTML: element => readOptions(element).columns, rendered: false },
    }
  },
  // Figure's insert command is inherited by extension; do not replace the
  // real figure command with one that would try to insert a gallery node.
  addCommands() { return {} },
  parseHTML() { return [{ tag: 'div[data-knowledge-gallery]' }] },
  renderHTML({ node }) {
    const options = parseOptions(`size=${node.attrs.thumbnailSize}${node.attrs.columns ? ` columns=${node.attrs.columns}` : ''}`)
    return ['div', {
      'data-knowledge-gallery': '',
      'data-thumbnail-size': String(options.size),
      ...(options.columns === null ? {} : { 'data-gallery-columns': String(options.columns) }),
      style: galleryStyle(options),
    }, 0]
  },
})
