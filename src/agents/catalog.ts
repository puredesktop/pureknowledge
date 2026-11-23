import type { KnowledgeMeaning } from '../lib/knowledgeMeaning'
import type { KnowledgeStore } from '../lib/knowledgeTypes'

/**
 * Exposed PureKnowledge operations (must stay in sync 1:1 with `plugin.json` -> `app.agents.tools[].name`).
 *
 * 3-tier exposure (built on `@purescience/platform-ui/bridge/appFunctions`):
 *   1. 4 composite `function` workflows (`fn_*`) — replace 3–8 atomic round-trips each
 *   2. 4 core atomic tools (44% of 9) — indispensable direct read/write verbs
 *   3. 3 universal escape-hatch meta-tools (`discoverAppTools`, `callExtendedReadTool`, `callExtendedTool`)
 *      providing full on-demand access to the remaining 5 specialist atomic tools.
 */
export const PUREKNOWLEDGE_FUNCTION_NAMES = [
  'fn_researchTopic',
  'fn_knowledgeHealthAudit',
  'fn_inspectPageNeighborhood',
  'fn_captureOrUpdateNote',
] as const

export const PUREKNOWLEDGE_CORE_TOOL_NAMES = [
  'getKnowledgeContext',
  'searchKnowledge',
  'readKnowledgePage',
  'applyKnowledgeChange',
] as const

export const PUREKNOWLEDGE_META_TOOL_NAMES = [
  'discoverAppTools',
  'callExtendedReadTool',
  'callExtendedTool',
] as const

export const EXPOSED_TOOL_NAMES = [
  ...PUREKNOWLEDGE_FUNCTION_NAMES,
  ...PUREKNOWLEDGE_CORE_TOOL_NAMES,
  ...PUREKNOWLEDGE_META_TOOL_NAMES,
] as const

/** Keep in sync with `plugin.json` -> `app.agents.tools[].name`. */
export const PUREKNOWLEDGE_AGENT_TOOL_NAMES = EXPOSED_TOOL_NAMES

export const PUREKNOWLEDGE_EXTENDED_TOOL_NAMES = [
  'listSpaces',
  'getBacklinks',
  'listKnowledgeActivity',
  'reviewKnowledge',
  'listKnowledgeChanges',
] as const

export const PUREKNOWLEDGE_ALL_ATOMIC_TOOL_NAMES = [
  ...PUREKNOWLEDGE_CORE_TOOL_NAMES,
  ...PUREKNOWLEDGE_EXTENDED_TOOL_NAMES,
] as const

export const PUREKNOWLEDGE_AGENT_LOG_LABEL = 'pureknowledge'

export const PRIVATE_ORGANISATION_ACCESS_ERROR =
  'Private organisation knowledge requires its organisation-scoped search_org_knowledge, read_org_knowledge and propose_org_knowledge tools. This ordinary app session cannot access it.'

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
