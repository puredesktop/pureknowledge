import type { KnowledgePage } from './knowledgeTypes'
import type { KnowledgeIndexFile } from './knowledgePages'
export const ORGANISATION_KNOWLEDGE_PATH: string
export function isPolicy(page: KnowledgePage): boolean
export function effectiveKnowledgePage(page: KnowledgePage, drafts?: boolean): KnowledgePage|null
export function knowledgeStatus(page: KnowledgePage, at?: string): string
export function publishKnowledgePage(page: KnowledgePage, by: string, at?: string): KnowledgePage
export function validateOrganisationLibrary(index: unknown, manifest: unknown, organisationId: string): void
export function parseOrganisationPage(raw: string, index: KnowledgeIndexFile): KnowledgePage
export function queryOrganisationKnowledge(index: KnowledgeIndexFile, pages: KnowledgePage[], args?: Record<string, unknown>, meaning?: { scores?: KnowledgeMeaningScores; reason?: string }|null): { organisationId?: string; root: {id:string;title:string}|null; query:string; searchedBy:'meaning-and-words'|'words'; searchNote?:string; total:number; pages:Array<{id:string;title:string;status:string;snippet:string;matched?:'words'|'meaning'|'both'}>; truncated:boolean; note:string }
export function readOrganisationKnowledge(index: KnowledgeIndexFile, pages: KnowledgePage[], args?: Record<string, unknown>): {organisationId?:string;id:string;title:string;body:string;status:string;nextOffset:number|null;[key:string]:unknown}
export function reviewOrganisationKnowledge(pages: KnowledgePage[]): {findings:Array<{page:string;title:string;issue:string}>;total:number;truncated:boolean}
export const KNOWLEDGE_SEARCH_INDEX_FILE: 'search-index.json'
export const KNOWLEDGE_SEARCH_FORMAT: 'pure-knowledge-search'
export type KnowledgeMeaningScores = Map<string,{score:number;at:number;end:number}>
export function knowledgeQueryTerms(query: string): string[]
export function quantizeKnowledgeVector(vector: ArrayLike<number>): Int8Array
export function knowledgeMeaningScores(index: {dimensions:number;pages:Record<string,{chunks:Array<{at:number;end:number}>;vectors:string}>}, queryVector: ArrayLike<number>, pages: readonly KnowledgePage[], options?: {drafts?:boolean}): KnowledgeMeaningScores
export function blendKnowledgeSearch(pages: readonly KnowledgePage[], query: string, scores?: KnowledgeMeaningScores): Array<{page:KnowledgePage;exact:boolean;score:number;matched:'words'|'meaning'|'both';at?:number;end?:number}>
