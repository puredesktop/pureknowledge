import { useEffect, useRef, useState, type RefObject } from 'react'
import type { DocumentEditorHandle } from '@purescience/platform-editor'
import { assetDropPoint } from '@purescience/platform-editor/extensions/collectionImagePaste.ts'
import { prepareKnowledgeDrop, type KnowledgeDrop } from '../lib/knowledgeDrop'
import { saveKnowledgeImage } from '../bridge/knowledgeAssets'
export function useKnowledgeDrop(options: { pageId?: string; packagePath: string; editing: boolean; surface: RefObject<HTMLElement|null>; editor: RefObject<DocumentEditorHandle|null>; insert: (drop: KnowledgeDrop, position?:number) => void }) {
  const current = useRef(options); current.current = options
  const [error,setError] = useState('')
  useEffect(()=>{
    let live = true
    const marker = document.createElement('div')
    marker.setAttribute('role','status')
    marker.style.cssText='position:fixed;pointer-events:none;z-index:2147483647;border-top:3px solid #26765d;background:#e8fff3;color:#163d30;font:12px sans-serif;padding:4px;display:none'
    document.body.append(marker)
    const clear=()=>{marker.style.display='none'}
    const receive=(event:MessageEvent)=>{
      if(window.parent===window || event.source!==window.parent || event.data?.type!=='pure:asset-drag')return
      const data=event.data, options=current.current
      const rect=options.surface.current?.getBoundingClientRect()
      if(!options.pageId || !rect || data.phase==='cancel' || !['image','reference','webpage','video'].includes(data.kind) || !Number.isFinite(data.x) || !Number.isFinite(data.y) || data.x<rect.left || data.x>rect.right || data.y<rect.top || data.y>rect.bottom){clear();return}
      const editor=options.editor.current?.getEditor()
      const point=options.editing && editor ? assetDropPoint(editor.view,data.x,data.y) : null
      if(options.editing && !point){clear();return}
      Object.assign(marker.style,{display:'block',left:`${point?.left ?? rect.left}px`,top:`${point?.top ?? Math.min(rect.bottom,window.innerHeight)-26}px`,width:`${point?.width ?? rect.width}px`})
      marker.textContent=options.editing?'Insert here':'Add at end of page'
      if(data.phase!=='drop')return
      clear();setError('')
      const before=editor?.state.doc
      void prepareKnowledgeDrop(data.asset,image=>saveKnowledgeImage(options.packagePath,image)).then(drop=>{
        if(!live)return
        const now=current.current
        if(now.pageId!==options.pageId || now.packagePath!==options.packagePath || now.editing!==options.editing || (options.editing && (now.editor.current?.getEditor()!==editor || editor?.isDestroyed || editor?.state.doc!==before)))throw Error('The destination changed. Drop again in the intended page.')
        now.insert(drop,point?.pos)
      }).catch(error=>{if(live)setError(error instanceof Error?error.message:String(error))})
    }
    window.addEventListener('message',receive);window.addEventListener('blur',clear)
    return ()=>{live=false;marker.remove();window.removeEventListener('message',receive);window.removeEventListener('blur',clear)}
  },[])
  return error
}
