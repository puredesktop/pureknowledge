import { useState } from 'react'
import { Button } from '@purescience/platform-ui/components/common/buttons/Button'
import { TextField } from '@purescience/platform-ui/components/common/inputs/TextField'
import type { KnowledgePage } from '../lib/knowledgeTypes'
import { isPolicy, knowledgeStatus, publishKnowledgePage } from '../lib/organisationKnowledge.mjs'

/** Human-only publication controls. No agent tool accepts publication metadata. */
export function PolicyPanel({page, editing, onChange}: {page:KnowledgePage;editing:boolean;onChange:(page:KnowledgePage)=>void}): React.ReactElement {
  const [error,setError]=useState('')
  if (!isPolicy(page)) return <></>
  const governance=page.governance ?? {category:'policy' as const}
  let publishedBody='The saved publication needs repair. Its text was preserved on disk.'
  if(governance.publication) {try {const saved=JSON.parse(governance.publication.content);if(typeof saved.body==='string')publishedBody=saved.body}catch {/* Keep malformed saved metadata from blanking the editor. */}}
  const update=(patch:Partial<NonNullable<KnowledgePage['governance']>>)=>onChange({...page,governance:{...governance,...patch}})
  return <section aria-label="Policy publication" style={{border:'1px solid var(--platform-colors-border)',borderRadius:10,padding:16,display:'grid',gap:10}}>
    <strong>Policy · {knowledgeStatus(page).replaceAll('-',' ')}</strong>
    <p>Only the human-published version is company policy. Working edits remain drafts; agents cannot publish them.</p>
    <label>Accountable owner<TextField aria-label="Policy owner" value={governance.owner??''} onChange={e=>update({owner:e.target.value})}/></label>
    <label>Review date<TextField aria-label="Policy review date" type="date" value={governance.reviewDue??''} onChange={e=>update({reviewDue:e.target.value})}/></label>
    <label>Sources · one per line<textarea aria-label="Policy sources" rows={2} value={(governance.sources??[]).join('\n')} onChange={e=>update({sources:e.target.value.split('\n').map(s=>s.trim()).filter(Boolean).slice(0,20)})}/></label>
    <div style={{display:'flex',gap:8,flexWrap:'wrap'}}><Button size="sm" variant="primary" disabled={editing} onClick={()=>{try{onChange(publishKnowledgePage(page,'You'));setError('')}catch(e){setError(String(e))}}}>Publish current policy</Button><Button size="sm" variant="subtle" disabled={editing} onClick={()=>update({archived:!governance.archived})}>{governance.archived?'Restore policy':'Archive policy'}</Button>{editing&&<small> Finish editing the text before publishing.</small>}</div>
    {governance.publication&&<details><summary>Published version · {governance.publication.at.slice(0,10)}</summary><pre style={{whiteSpace:'pre-wrap'}}>{publishedBody}</pre></details>}
    {error&&<p role="alert">{error}</p>}
  </section>
}
