// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest'
import { prepareKnowledgeDrop, embedKnowledgeVideos } from './knowledgeDrop'
import { normalizeCollectionDocumentHtml, prepareCollectionDocumentHtml } from '@purescience/platform-ui/bridge/collectionDocumentHtml'
import { toMd, toHtml } from '@purescience/platform-editor'
const transfer=(content:object)=>JSON.stringify({version:1,...content})
it('registers image snapshots and round-trips relative assets through Markdown',async()=>{
 const save=vi.fn(async()=>({relativePath:'assets/chart.png',absolutePath:'/notes.knowledge/assets/chart.png',dataUrl:'data:image/png;base64,YQ=='}))
 const drop=await prepareKnowledgeDrop(transfer({name:'chart.png',alt:'Revenue',dataUrl:'data:image/png;base64,YQ=='}),save)
 expect(save).toHaveBeenCalledOnce()
 const md=toMd(normalizeCollectionDocumentHtml(drop.html,'/notes.knowledge'))
 expect(md).toBe('![Revenue](assets/chart.png)')
 expect(drop.link.path).toBe('/notes.knowledge/assets/chart.png')
 const html=await prepareCollectionDocumentHtml(toHtml(md),'/notes.knowledge',async()=>({mimeType:'image/png',base64:'YQ=='}))
 expect(html).toContain('data:image/png;base64,YQ==')
})
it('adds linked citation callouts and full reference text',async()=>{
 const drop=await prepareKnowledgeDrop(transfer({kind:'reference',reference:{id:'paper',title:'Fish <Study>',authors:[{family:'Smith'}],year:2026,doi:'10.1234/fish'}}),vi.fn())
 expect(drop.html).toContain('(Smith, 2026)')
 expect(drop.reference).toContain('Fish &lt;Study&gt;')
 expect(drop.link.url).toBe('https://doi.org/10.1234/fish')
})
it('keeps videos editable as links and restores embeds after saving Markdown',async()=>{
 const drop=await prepareKnowledgeDrop(transfer({kind:'video',url:'https://youtu.be/dQw4w9WgXcQ',title:'A video'}),vi.fn())
 const saved=toMd(drop.html)
 expect(saved).toContain('Video: A video')
 const html=embedKnowledgeVideos(toHtml(saved))
 expect(html).toContain('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ')
 expect(html).toContain('strict-origin-when-cross-origin')
 expect(drop.link.url).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
})
it('does not turn arbitrary links or unsafe URLs into embeds',async()=>{
 expect(embedKnowledgeVideos('<p><a href="https://example.com">Video: Test</a></p>')).not.toContain('iframe')
 await expect(prepareKnowledgeDrop(transfer({kind:'webpage',reference:{title:'Bad',url:'javascript:alert(1)'}}),vi.fn())).rejects.toThrow()
})
