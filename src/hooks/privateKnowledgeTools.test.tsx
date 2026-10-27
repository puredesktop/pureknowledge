// @vitest-environment happy-dom
import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {expect,it,vi} from 'vitest'
const captured=vi.hoisted(()=>({options:null as any}))
vi.mock('@purescience/platform-ui/bridge/react/usePlatformAgentTools',()=>({usePlatformAgentTools:(options:unknown)=>{captured.options=options}}))
import {useKnowledgeAgentTools} from './useKnowledgeAgentTools'
import {createOrganisationKnowledge} from '../lib/createOrganisationKnowledge'
import {createDefaultKnowledgeStore} from '../lib/knowledgeStore'
it('refuses every unscoped app-agent tool on private organisation data while retaining personal tools',async()=>{
 ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true
 const root=createRoot(document.createElement('div'))
 let store=createOrganisationKnowledge('secret','Secret company')
 const saveStore=vi.fn()
 function Harness(){useKnowledgeAgentTools(true,{store,storePath:'/secret/Knowledge/Organisation.knowledge',saveStore});return null}
 await act(async()=>root.render(<Harness/>))
 for(const handler of Object.values(captured.options.handlers) as Array<(arg:unknown)=>Promise<{content:string;isError?:boolean}>>){
  const result=await handler({arguments:{organisationId:'secret'},session:'foreign-agent'})
  expect(result.isError).toBe(true);expect(result.content).not.toContain('Secret company')
 }
 expect(saveStore).not.toHaveBeenCalled()
 store=createDefaultKnowledgeStore();await act(async()=>root.render(<Harness/>))
 const result=await captured.options.handlers.getKnowledgeContext({arguments:{}})
 expect(result.isError).not.toBe(true)
 await act(async()=>root.unmount())
})
