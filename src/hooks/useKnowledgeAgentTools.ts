import { useRef } from 'react'
import {
  usePlatformAgentTools,
  type AgentToolInvokeContext,
} from '@purescience/platform-ui/bridge/react/usePlatformAgentTools'
import {
  AgentKnowledgeToolError,
  EXPOSED_TOOL_NAMES,
  PRIVATE_ORGANISATION_ACCESS_ERROR,
  PUREKNOWLEDGE_AGENT_LOG_LABEL,
  type KnowledgeAgentToolContext,
} from '../agents/catalog'
import { buildPureKnowledgeHandlers } from '../agents/operationsRegistry'

export function useKnowledgeAgentTools(
  ready: boolean,
  context: KnowledgeAgentToolContext,
): void {
  const contextRef = useRef(context)
  contextRef.current = context

  const registryHandlers = buildPureKnowledgeHandlers(() => contextRef.current)

  // Statically key-preserving registration so `scripts/check-manifests.mjs`
  // can verify every exposed manifest operation has a live registered handler.
  // App tool invocations do not carry a trusted organisation principal;
  // never infer one from a model argument or from the currently visible page.
  usePlatformAgentTools({
    ready,
    tools: EXPOSED_TOOL_NAMES,
    logLabel: PUREKNOWLEDGE_AGENT_LOG_LABEL,
    errorType: AgentKnowledgeToolError,
    handlers: Object.fromEntries(
      EXPOSED_TOOL_NAMES.map(name => [
        name,
        async (invoke: AgentToolInvokeContext) => {
          if (contextRef.current.store?.organisationId) {
            return {
              content: PRIVATE_ORGANISATION_ACCESS_ERROR,
              isError: true,
            }
          }
          return registryHandlers[name]!(invoke)
        },
      ]),
    ),
  })
}
