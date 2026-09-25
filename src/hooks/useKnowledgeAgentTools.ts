import { useRef } from 'react'
import { usePlatformAgentTools } from '@purescience/platform-ui/bridge/react/usePlatformAgentTools'
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

  usePlatformAgentTools({
    ready,
    tools: PUREKNOWLEDGE_AGENT_TOOL_NAMES,
    logLabel: PUREKNOWLEDGE_AGENT_LOG_LABEL,
    errorType: AgentKnowledgeToolError,
    handlers: {
      getKnowledgeContext: async () =>
        getKnowledgeContextHandler(contextRef.current),
      searchKnowledge: async invoke =>
        searchKnowledgeHandler(contextRef.current, invoke.arguments ?? {}),
      readKnowledgePage: async invoke =>
        readKnowledgePageHandler(contextRef.current, invoke.arguments ?? {}),
      listSpaces: async () => listSpacesHandler(contextRef.current),
      getBacklinks: async invoke =>
        getBacklinksHandler(contextRef.current, invoke.arguments ?? {}),
      listKnowledgeActivity: async invoke =>
        listKnowledgeActivityHandler(contextRef.current, invoke.arguments ?? {}),
      reviewKnowledge: async invoke =>
        reviewKnowledgeHandler(contextRef.current, invoke.arguments ?? {}),
      applyKnowledgeChange: async invoke =>
        applyKnowledgeChangeHandler(contextRef.current, invoke.arguments ?? {}),
      listKnowledgeChanges: async invoke =>
        listKnowledgeChangesHandler(contextRef.current, invoke.arguments ?? {}),
    },
  })
}
