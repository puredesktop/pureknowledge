import { expect, it } from 'vitest'
import { createOrganisationKnowledge } from './createOrganisationKnowledge'
import { createKnowledgePage, updateKnowledgePage, proposeKnowledgeAgentChange, acceptKnowledgeAgentChange } from './knowledgeStore'
import { pageFileName, parsePageFile, serializePageFile, serializeKnowledgeIndex, assembleKnowledgeStore } from './knowledgePages'
import { createKnowledgePackageManifest } from './knowledgePackage'
import { resolveKnowledgeWorkspaceTarget } from './knowledgePaths'
import { effectiveKnowledgePage, knowledgeStatus, publishKnowledgePage, queryOrganisationKnowledge, readOrganisationKnowledge, reviewOrganisationKnowledge, validateOrganisationLibrary } from './organisationKnowledge.mjs'
const at='2026-10-27T12:00:00Z'
it('accepts reviewed organisation changes only against their exact baseline; policies remain drafts after acceptance',()=>{
 let {store}=setup()
 const parent=store.pages.find(p=>p.title==='Policies')!
 store=createKnowledgePage(store,{spaceId:store.activeSpaceId,kind:'wiki',title:'Policy test',parentId:parent.id,body:'Original'})
 const page=store.pages.find(p=>p.title==='Policy test')!
 store=proposeKnowledgeAgentChange(store,{spaceId:page.spaceId,pageId:page.id,agentName:'Steward',title:'Policy test',summary:'Improve wording',changeType:'page.update',expectedPage:JSON.stringify(page),patch:{body:'Proposed'}})
 const id=store.agentChanges![0]!.id
 const stale=updateKnowledgePage(store,page.id,{body:'New human wording'})
 expect(()=>acceptKnowledgeAgentChange(stale,id)).toThrow('changed after')
 const accepted=acceptKnowledgeAgentChange(store,id)
 expect(accepted.pages.find(p=>p.id===page.id)?.body).toBe('Proposed')
 expect(knowledgeStatus(accepted.pages.find(p=>p.id===page.id)!)).toBe('draft')
})
function setup(){const store=createOrganisationKnowledge('one','One',['Design','Engineering']);return {store,index:JSON.parse(serializeKnowledgeIndex(store))}}
it('filing an existing page under Policies creates a draft and never makes it published',()=>{
 let {store}=setup()
 store=createKnowledgePage(store,{spaceId:store.activeSpaceId,kind:'wiki',title:'Existing rule',body:'Existing wording'})
 const page=store.pages.find(p=>p.title==='Existing rule')!,policies=store.pages.find(p=>p.title==='Policies')!
 store=updateKnowledgePage(store,page.id,{parentId:policies.id})
 expect(store.pages.find(p=>p.id===page.id)?.governance?.category).toBe('policy')
 expect(knowledgeStatus(store.pages.find(p=>p.id===page.id)!)).toBe('draft')
})
it('starts at one organisation root, fans out, and roundtrips the binding in native files',()=>{
 const {store,index}=setup()
 const manifest=createKnowledgePackageManifest('Organisation.knowledge',store)
 validateOrganisationLibrary(index,manifest,'one')
 const root=store.pages.find(p=>p.id===store.activePageId)!
 expect(root.title).toBe('One')
 expect(store.pages.filter(p=>p.parentId===root.id).map(p=>p.title).sort()).toEqual(['Decisions','Departments','Policies','Procedures','Products','Reference'])
 expect(queryOrganisationKnowledge(index,store.pages).pages).toHaveLength(6)
 expect(queryOrganisationKnowledge(index,store.pages).pages.every(p=>p.snippet.length<=240)).toBe(true)
 const reopened=assembleKnowledgeStore(index,store.pages.map(p=>parsePageFile(serializePageFile(p))!),[],[])
 expect(reopened.organisationId).toBe('one')
 expect(store.pages.every(p=>pageFileName(p).endsWith('.md'))).toBe(true)
 for(const id of ['two','', '../one']) expect(()=>validateOrganisationLibrary(index,manifest,id)).toThrow('bound')
 expect(()=>validateOrganisationLibrary({...index,organisationId:'two'},manifest,'one')).toThrow()
 expect(()=>resolveKnowledgeWorkspaceTarget('/two/Knowledge/Organisation.knowledge','/personal/wiki.knowledge','/one',{id:'one',folder:'/one'})).toThrow('bound')
 expect(resolveKnowledgeWorkspaceTarget(null,'/personal/wiki.knowledge','/one',{id:'one',folder:'/one'}).packagePath).toBe('/one/Knowledge/Organisation.knowledge')
})
it('keeps draft policy out of default reads, retains the published wording during edits, and catches overdue review',()=>{
 let {store,index}=setup()
 const parent=store.pages.find(p=>p.title==='Policies')!
 store=createKnowledgePage(store,{spaceId:store.activeSpaceId,parentId:parent.id,title:'Email authority',kind:'wiki',body:'Never send without the owner.'})
 let page=store.pages.find(p=>p.title==='Email authority')!
 expect(knowledgeStatus(page,at)).toBe('draft')
 expect(queryOrganisationKnowledge(index,store.pages,{query:'Email'}).pages).toEqual([])
 expect(()=>readOrganisationKnowledge(index,store.pages,{page:page.id})).toThrow('unpublished')
 expect(readOrganisationKnowledge(index,store.pages,{page:page.id,includeDrafts:true}).body).toContain('Never send')
 expect(()=>publishKnowledgePage(page,'Owner',at)).toThrow('owner')
 page={...page,governance:{category:'policy',owner:'Operations lead',reviewDue:'2027-01-01',sources:['Owner instruction, 27 October 2026']}}
 page=publishKnowledgePage(page,'Owner',at)
 expect(knowledgeStatus(page,at)).toBe('published')
 store={...store,pages:store.pages.map(p=>p.id===page.id?page:p)}
 store=updateKnowledgePage(store,page.id,{body:'Proposed new wording.'},{actor:{type:'agent',name:'Curator'}})
 page=store.pages.find(p=>p.id===page.id)!
 expect(knowledgeStatus(page,at)).toBe('published-with-draft')
 expect(readOrganisationKnowledge(index,store.pages,{page:page.id}).body).toBe('Never send without the owner.')
 expect(readOrganisationKnowledge(index,store.pages,{page:page.id,includeDrafts:true}).body).toBe('Proposed new wording.')
 expect(effectiveKnowledgePage(page)?.body).toBe('Never send without the owner.')
 expect(knowledgeStatus(page,'2027-02-01')).toBe('review-due')
 expect(reviewOrganisationKnowledge(store.pages).findings.some(f=>f.page===page.id)).toBe(true)
 expect(parsePageFile(serializePageFile(page))?.governance?.publication).toEqual(page.governance?.publication)
})
it('bounds search/read payloads, supports section reads and refuses foreign IDs',()=>{
 let {store,index}=setup()
 for(let i=0;i<25;i++)store=createKnowledgePage(store,{spaceId:store.activeSpaceId,title:`Search ${i}`,kind:'wiki',body:'# Evidence\n'+ 'topic '.repeat(5000)+'\n# Other\nShort'})
 const result=queryOrganisationKnowledge(index,store.pages,{query:'topic',limit:9999})
 expect(result.pages).toHaveLength(12)
 expect(result.truncated).toBe(true)
 const read=readOrganisationKnowledge(index,store.pages,{page:result.pages[0]!.id,maxChars:999999})
 expect(read.body.length).toBe(12000);expect(read.nextOffset).toBe(12000)
 expect(readOrganisationKnowledge(index,store.pages,{page:read.id,section:'Other'}).body).toBe('# Other\nShort')
 const foreign=createOrganisationKnowledge('two','Secret Two').pages[0]!
 expect(()=>readOrganisationKnowledge(index,store.pages,{page:foreign.id})).toThrow('this organisation')
 expect(()=>readOrganisationKnowledge(index,store.pages,{page:'../../two'})).toThrow('this organisation')
})
