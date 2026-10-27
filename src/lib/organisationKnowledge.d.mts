import type { KnowledgePage } from './knowledgeTypes'
import type { KnowledgeIndexFile } from './knowledgePages'
export const ORGANISATION_KNOWLEDGE_PATH: string
export function isPolicy(page: KnowledgePage): boolean
export function effectiveKnowledgePage(page: KnowledgePage, drafts?: boolean): KnowledgePage|null
export function knowledgeStatus(page: KnowledgePage, at?: string): string
export function publishKnowledgePage(page: KnowledgePage, by: string, at?: string): KnowledgePage
export function validateOrganisationLibrary(index: unknown, manifest: unknown, organisationId: string): void
export function parseOrganisationPage(raw: string, index: KnowledgeIndexFile): KnowledgePage
export function queryOrganisationKnowledge(index: KnowledgeIndexFile, pages: KnowledgePage[], args?: Record<string, unknown>): { organisationId?: string; root: {id:string;title:string}|null; query:string; total:number; pages:Array<{id:string;title:string;status:string;snippet:string}>; truncated:boolean; note:string }
export function readOrganisationKnowledge(index: KnowledgeIndexFile, pages: KnowledgePage[], args?: Record<string, unknown>): {organisationId?:string;id:string;title:string;body:string;status:string;nextOffset:number|null;[key:string]:unknown}
export function reviewOrganisationKnowledge(pages: KnowledgePage[]): {findings:Array<{page:string;title:string;issue:string}>;total:number;truncated:boolean}
