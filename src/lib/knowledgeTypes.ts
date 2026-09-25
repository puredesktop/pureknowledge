export type KnowledgePageKind = 'wiki' | 'note'

export interface KnowledgeSpace {
  id: string
  name: string
  description: string
  rootPageId: string | null
  createdAt: string
  updatedAt: string
}

export interface KnowledgeLink {
  id: string
  type: 'file' | 'app' | 'url' | 'resource'
  title: string
  path?: string
  appSlug?: string
  resourceId?: string
  url?: string
}

export interface KnowledgePage {
  id: string
  spaceId: string
  parentId: string | null
  kind: KnowledgePageKind
  slug: string
  title: string
  body: string
  tags: string[]
  links: KnowledgeLink[]
  aliases?: string[]
  createdAt: string
  updatedAt: string
  promotedAt?: string
}

export interface KnowledgeActivity {
  id: string
  pageId?: string
  at: string
  actorType?: 'human' | 'agent' | 'system'
  actorName?: string
  type:
    | 'space.created'
    | 'page.created'
    | 'page.updated'
    | 'page.promoted'
    | 'page.deleted'
    | 'link.created'
    | 'agentChange.proposed'
    | 'agentChange.accepted'
    | 'agentChange.rejected'
    | 'agentChange.applied'
  text: string
}

/**
 * 'applied' is the direct-write model: the change hit the wiki when it was
 * made and this record is its audit-log entry. 'pending'/'accepted'/
 * 'rejected' remain for entries queued under the old proposal model.
 */
export type KnowledgeAgentChangeStatus =
  | 'pending'
  | 'accepted'
  | 'rejected'
  | 'applied'
export type KnowledgeAgentChangeSeverity = 'low' | 'normal' | 'critical'
export type KnowledgeAgentChangeType =
  | 'page.create'
  | 'page.update'
  | 'page.link'
  | 'page.rename'
  | 'page.promote'
  | 'page.delete'
  | 'page.merge'

export interface KnowledgeAgentChangePatch {
  title?: string
  body?: string
  tags?: string[]
  kind?: KnowledgePageKind
  parentId?: string | null
  link?: Partial<KnowledgeLink>
  links?: Partial<KnowledgeLink>[]
  /** page.merge: the surviving page the source page merges into. */
  mergeIntoPageId?: string
}

export interface KnowledgeAgentChange {
  id: string
  spaceId: string
  pageId?: string
  agentName: string
  agentId?: string
  sourceAppSlug?: string
  proposedAt: string
  reviewedAt?: string
  status: KnowledgeAgentChangeStatus
  severity: KnowledgeAgentChangeSeverity
  changeType: KnowledgeAgentChangeType
  title: string
  summary: string
  before?: string
  after?: string
  patch: KnowledgeAgentChangePatch
}

export interface KnowledgeStore {
  schemaVersion: 1
  spaces: KnowledgeSpace[]
  pages: KnowledgePage[]
  activity: KnowledgeActivity[]
  agentChanges?: KnowledgeAgentChange[]
  activeSpaceId: string
  activePageId: string | null
}

export interface CreatePageInput {
  spaceId: string
  kind: KnowledgePageKind
  parentId?: string | null
  title: string
  body?: string
  tags?: string[]
}

export interface CreateSpaceInput {
  name: string
  description?: string
}
