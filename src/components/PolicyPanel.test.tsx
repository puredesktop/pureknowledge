// @vitest-environment happy-dom
import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {expect,it,vi} from 'vitest'
import {PolicyPanel} from './PolicyPanel'
import type {KnowledgePage} from '../lib/knowledgeTypes'
import {createDefaultKnowledgeStore} from '../lib/knowledgeStore'
it('publishes only the visible human-reviewed policy, requiring its owner, sources and review date',async()=>{
 ;(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true
 const host=document.body.appendChild(document.createElement('div')),root=createRoot(host),change=vi.fn()
 let page:KnowledgePage={...createDefaultKnowledgeStore().pages[0]!,title:'Approval policy',body:'Ask before sending.',tags:['policy']}
 await act(async()=>root.render(<PolicyPanel page={page} editing={false} onChange={change}/>))
 await act(async()=>host.querySelector<HTMLButtonElement>('button')!.click())
 expect(change).not.toHaveBeenCalled();expect(host.textContent).toContain('needs content, an owner')
 page={...page,governance:{category:'policy',owner:'Operations',sources:['Owner instruction'],reviewDue:'2099-01-01'}}
 await act(async()=>root.render(<PolicyPanel page={page} editing={true} onChange={change}/>))
 expect(host.querySelector<HTMLButtonElement>('button')!.disabled).toBe(true)
 await act(async()=>root.render(<PolicyPanel page={page} editing={false} onChange={change}/>))
 await act(async()=>host.querySelector<HTMLButtonElement>('button')!.click())
 expect(JSON.parse(change.mock.calls[0]![0].governance.publication.content).body).toBe('Ask before sending.')
 await act(async()=>root.unmount());host.remove()
})
