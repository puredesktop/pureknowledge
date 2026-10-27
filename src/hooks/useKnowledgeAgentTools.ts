import { useRef } from 'react'
import { usePlatformAgentTools, type AgentToolHandler } from '@purescience/platform-ui/bridge/react/usePlatformAgentTools'
import {
  AgentKnowledgeToolError,
  PUREKNOWLEDGE_AGENT_LOG_LABEL,
  PUREKNOWLEDGE_AGENT_TOOL_NAMES,
  type KnowledgeAgentToolContext,
} from '../agents/catalog'
import {
  applyKnowledgeChangeHandler,
  getBacklinksHandler,
  getKnowledgeContextHandler,
  listKnowledgeActivityHandler,
  listKnowledgeChangesHandler,
  listSpacesHandler,
  readKnowledgePageHandler,
  reviewKnowledgeHandler,
  searchKnowledgeHandler,
} from '../agents/handlers'

export function useKnowledgeAgentTools(
  ready: boolean,
  context: KnowledgeAgentToolContext,
): void {
  const contextRef = useRef(context)
  contextRef.current = context
  // App tool invocations do not carry a trusted organisation principal.
  // Never infer one from a model argument or from the currently visible page.
  // Organisation agents use the bound MCP and its reviewed proposal path.
  const privateAccess=(handler:AgentToolHandler):AgentToolHandler=>async invoke=>contextRef.current.store?.organisationId
    ? {content:'Private organisation knowledge requires its organisation-scoped search_org_knowledge, read_org_knowledge and propose_org_knowledge tools. This ordinary app session cannot access it.',isError:true}
    : handler(invoke)

  usePlatformAgentTools({
    ready,
    tools: PUREKNOWLEDGE_AGENT_TOOL_NAMES,
    logLabel: PUREKNOWLEDGE_AGENT_LOG_LABEL,
    errorType: AgentKnowledgeToolError,
    handlers: {
      getKnowledgeContext: privateAccess(async () => getKnowledgeContextHandler(contextRef.current)),
      searchKnowledge: privateAccess(async invoke => searchKnowledgeHandler(contextRef.current, invoke.arguments ?? {})),
      readKnowledgePage: privateAccess(async invoke => readKnowledgePageHandler(contextRef.current, invoke.arguments ?? {})),
      listSpaces: privateAccess(async () => listSpacesHandler(contextRef.current)),
      getBacklinks: privateAccess(async invoke => getBacklinksHandler(contextRef.current, invoke.arguments ?? {})),
      listKnowledgeActivity: privateAccess(async invoke => listKnowledgeActivityHandler(contextRef.current, invoke.arguments ?? {})),
      reviewKnowledge: privateAccess(async invoke => reviewKnowledgeHandler(contextRef.current, invoke.arguments ?? {})),
      applyKnowledgeChange: privateAccess(async invoke => applyKnowledgeChangeHandler(contextRef.current, invoke.arguments ?? {})),
      listKnowledgeChanges: privateAccess(async invoke => listKnowledgeChangesHandler(contextRef.current, invoke.arguments ?? {})),
    },
  })
}
