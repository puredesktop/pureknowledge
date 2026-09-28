// @vitest-environment happy-dom
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Figure } from '@purescience/platform-editor'
import { describe, expect, it } from 'vitest'
import {
  KnowledgeGallery,
  KnowledgeFigure,
  addKnowledgeGalleryControls,
  appendKnowledgeGalleryImages,
  knowledgeHtmlToMarkdown,
  knowledgeMarkdownToHtml,
  removeKnowledgeGalleryImage,
  setKnowledgeGalleryImageBackground,
  upgradeLegacyKnowledgeGalleries,
} from './knowledgeGallery'

describe('knowledge galleries', () => {
  const markdown = [
    ':::gallery size=88 columns=6',
    '![Tasks](assets/tasks.svg)',
    '![Pitch slide](assets/slide.png)',
    ':::',
  ].join('\n')

  it('renders the durable syntax as a sized, captioned gallery', () => {
    const document = new DOMParser().parseFromString(knowledgeMarkdownToHtml(markdown), 'text/html')
    const gallery = document.querySelector<HTMLElement>('[data-knowledge-gallery]')!
    expect(gallery.dataset.thumbnailSize).toBe('88')
    expect(gallery.dataset.galleryColumns).toBe('6')
    expect(gallery.style.getPropertyValue('--knowledge-gallery-size')).toBe('88px')
    expect(gallery.querySelectorAll('figure')).toHaveLength(2)
    expect(gallery.querySelector('figcaption')?.textContent).toBe('Tasks')
  })

  it('leaves gallery examples inside fenced code untouched', () => {
    const html = knowledgeMarkdownToHtml(['```markdown', markdown, '```'].join('\n'))
    expect(html).not.toContain('data-knowledge-gallery')
    expect(html).toContain(':::gallery size=88 columns=6')
  })

  it('survives a rich-editor HTML round-trip', () => {
    const editor = new Editor({
      extensions: [StarterKit, Figure, KnowledgeGallery],
      content: knowledgeMarkdownToHtml(markdown),
    })
    const saved = knowledgeHtmlToMarkdown(editor.getHTML(), '/wiki/brand.knowledge')
    editor.destroy()
    expect(saved).toBe(markdown)
  })

  it('does not replace the editor figure insertion command', () => {
    const editor = new Editor({ extensions: [StarterKit, KnowledgeFigure, KnowledgeGallery] })
    editor.commands.insertFigure({ src: 'assets/chart.png', alt: 'Chart', caption: 'Results' })
    expect(editor.getHTML()).toContain('<figure>')
    expect(editor.getHTML()).not.toContain('data-knowledge-gallery')
    editor.destroy()
  })

  it('preserves per-image backgrounds through the rich editor', () => {
    const source = [
      ':::gallery size=88',
      '![Transparent logo](assets/logo.svg) {background=dark}',
      ':::',
    ].join('\n')
    const editor = new Editor({
      extensions: [StarterKit, KnowledgeFigure, KnowledgeGallery],
      content: knowledgeMarkdownToHtml(source),
    })
    expect(editor.getHTML()).toContain('data-gallery-background="dark"')
    expect(knowledgeHtmlToMarkdown(editor.getHTML(), '/wiki/brand.knowledge')).toBe(source)
    editor.destroy()
  })

  it('adds, removes, and changes gallery images without touching surrounding content', () => {
    const withImage = appendKnowledgeGalleryImages(markdown, 0, [{
      alt: 'Logo',
      src: 'assets/logo.svg',
      background: 'dark',
    }])
    expect(withImage).toContain('![Logo](assets/logo.svg) {background=dark}')
    const changed = setKnowledgeGalleryImageBackground(withImage, 0, 2, 'checkerboard')
    expect(changed).toContain('![Logo](assets/logo.svg) {background=checkerboard}')
    expect(removeKnowledgeGalleryImage(changed, 0, 2)).toBe(markdown)
  })

  it('does not count gallery examples in fenced code when applying UI changes', () => {
    const page = ['```markdown', markdown, '```', '', markdown].join('\n')
    const changed = appendKnowledgeGalleryImages(page, 0, [{ alt: 'Logo', src: 'assets/logo.svg' }])
    expect(changed.split('![Logo](assets/logo.svg)')).toHaveLength(2)
    expect(changed.indexOf('![Logo](assets/logo.svg)')).toBeGreaterThan(changed.indexOf('```', 3))
  })

  it('adds accessible management controls only when requested', () => {
    const controlled = addKnowledgeGalleryControls(knowledgeMarkdownToHtml(markdown))
    expect(controlled).toContain('data-gallery-add="0"')
    expect(controlled).toContain('data-gallery-background="0:0"')
    expect(controlled).toContain('data-gallery-download="0:0"')
    expect(controlled).toContain('data-gallery-remove="0:1"')
    expect(controlled).toContain('<svg')
    expect(controlled).not.toContain('>Background:')
    expect(controlled).not.toContain('>Remove</button>')
  })

  it('upgrades the existing raw-HTML grid convention before editing', () => {
    const legacy = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(88px,1fr))"><figure><img src="assets/tasks.svg" width="88" alt="Tasks"><figcaption>Tasks</figcaption></figure></div>'
    const upgraded = upgradeLegacyKnowledgeGalleries(legacy)
    expect(upgraded).toContain('data-knowledge-gallery=""')
    expect(upgraded).toContain('data-thumbnail-size="88"')
    expect(knowledgeHtmlToMarkdown(upgraded, '/wiki/brand.knowledge')).toBe([
      ':::gallery size=88',
      '![Tasks](assets/tasks.svg)',
      ':::',
    ].join('\n'))
  })
})
