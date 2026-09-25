import { readAssetTransfer } from '@purescience/platform-editor/assetTransfer.ts'
import { readSourceTransfer, sourceDescription, sourceLabel } from '@purescience/platform-editor/sourceTransfer.ts'
import { readVideoTransfer, videoEmbedMarkup } from '@purescience/platform-ui/bridge/videoTransfer'
import type { KnowledgeLink } from './knowledgeTypes'
export const escapeDropHtml = (text: string) => text.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!))
export interface KnowledgeDrop { html: string; reference?: string; link: Partial<KnowledgeLink> }
export async function prepareKnowledgeDrop(value: string, saveImage: (image: ReturnType<typeof readAssetTransfer>) => Promise<{relativePath:string;dataUrl:string;absolutePath:string}>): Promise<KnowledgeDrop> {
  if (value.length > 24 * 1024 * 1024) throw new Error('This item is too large to insert.')
  const input = JSON.parse(value)
  if (!input.kind || input.kind === 'image') {
    const image = readAssetTransfer(value)
    const saved = await saveImage(image)
    const alt = escapeDropHtml(image.alt)
    const img = `<img src="${escapeDropHtml(saved.dataUrl)}" data-writer-asset-src="${escapeDropHtml(saved.relativePath)}" alt="${alt}">`
    return {html: image.caption ? `<figure>${img}<figcaption>${escapeDropHtml(image.caption)}</figcaption></figure>` : img, link:{type:'file',title:image.alt || image.name,path:saved.absolutePath}}
  }
  if (input.kind === 'video') {
    const video = readVideoTransfer(value)
    return {html:`<p><a href="${escapeDropHtml(video.url)}">Video: ${escapeDropHtml(video.title)}</a></p>`,link:{type:'url',title:video.title,url:video.url}}
  }
  const {reference} = readSourceTransfer(value)
  const url = reference.url || (reference.doi ? `https://doi.org/${reference.doi.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i,'')}` : '')
  const label = escapeDropHtml(sourceLabel(reference))
  const description = escapeDropHtml(sourceDescription(reference))
  return {html:`<p>${url ? `<a href="${escapeDropHtml(url)}">${label}</a>` : label}</p>`,reference:`<p>${url ? `<a href="${escapeDropHtml(url)}">${description}</a>` : description}</p>`,link:{type:url?'url':'resource',title:sourceDescription(reference),url:url || undefined,resourceId:reference.id || undefined}}
}
/** Store video as an ordinary Markdown link; only this explicit marker becomes a player. */
export function embedKnowledgeVideos(html: string): string {
  const document = new DOMParser().parseFromString(html,'text/html')
  for (const link of Array.from(document.querySelectorAll('p > a[href]'))) {
    if (!link.textContent?.startsWith('Video: ') || link.parentElement?.textContent !== link.textContent) continue
    try {
      const video = readVideoTransfer(JSON.stringify({version:1,kind:'video',url:link.getAttribute('href'),title:link.textContent.slice(7)}))
      link.parentElement.outerHTML = videoEmbedMarkup(video)
    } catch { /* An edited or unsupported URL remains a normal link. */ }
  }
  return document.body.innerHTML
}
