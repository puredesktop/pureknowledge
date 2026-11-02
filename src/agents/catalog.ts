import type { KnowledgeMeaning } from '../lib/knowledgeMeaning'
import type { KnowledgeStore } from '../lib/knowledgeTypes'

/** Keep in sync with `plugin.json` -> `app.agents.tools[].name`. */
export const PUREKNOWLEDGE_AGENT_TOOL_NAMES = [
  'getKnowledgeContext',
  'searchKnowledge',
  'readKnowledgePage',
  'listSpaces',
  'getBacklinks',
  'listKnowledgeActivity',
  'reviewKnowledge',
  'applyKnowledgeChange',
  'listKnowledgeChanges',
] as const

export const PUREKNOWLEDGE_AGENT_LOG_LABEL = 'pureknowledge'

export class AgentKnowledgeToolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AgentKnowledgeToolError'
  }
}

/**
 * Reads and writes are direct. Every agent write lands in the wiki
 * immediately and is recorded in the agent log with before/after — the
 * log, not a review queue, is the accountability mechanism.
 */
export interface KnowledgeAgentToolContext {
  store: KnowledgeStore | null
  saveStore: (
    update: KnowledgeStore | ((current: KnowledgeStore) => KnowledgeStore),
  ) => Promise<void>
  storePath: string
  /** Search by meaning, when this host can offer it; without it search is by words and says so. */
  meaning?: KnowledgeMeaning
}
