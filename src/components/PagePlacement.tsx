import {SelectField} from '@purescience/platform-ui/components/common/inputs/SelectField'
import {wouldCreateParentCycle} from '../lib/knowledgeStore'
import type {KnowledgePage,KnowledgeStore} from '../lib/knowledgeTypes'
export function PagePlacement({page,store,onChange}:{page:KnowledgePage;store:KnowledgeStore;onChange:(parent:string|null)=>void}):React.ReactElement {
  const space=store.spaces.find(s=>s.id===page.spaceId)
  if(space?.rootPageId===page.id)return <></>
  const options=store.pages.filter(p=>p.kind==='wiki'&&p.spaceId===page.spaceId&&!wouldCreateParentCycle(store,page.id,p.id)).sort((a,b)=>a.title.localeCompare(b.title)).map(p=>({value:p.id,label:p.id===space?.rootPageId?`${space.name} · root`:p.title}))
  return <label>Filed under<SelectField aria-label="Filed under" value={page.parentId??''} options={[{value:'',label:'Top level'},...options]} onValueChange={value=>onChange(value||null)}/></label>
}
