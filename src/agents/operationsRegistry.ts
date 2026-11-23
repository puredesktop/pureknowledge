import {
  createAppOperationsRegistry,
  defineAppTool,
  type AppAtomicToolDefinition,
  type BuildHandlersOptions,
} from '@purescience/platform-ui/bridge/appFunctions'
import type { AgentToolHandler } from '@purescience/platform-ui/bridge/react/usePlatformAgentTools'
import { PUREKNOWLEDGE_ATOMIC_TOOL_SCHEMAS } from './atomicToolSchemas'
import {
  AgentKnowledgeToolError,
  PRIVATE_ORGANISATION_ACCESS_ERROR,
  type KnowledgeAgentToolContext,
} from './catalog'
import { PUREKNOWLEDGE_FUNCTIONS } from './functions'
import { PUREKNOWLEDGE_ATOMIC_RUNNERS } from './handlers'

const atomicTools: AppAtomicToolDefinition<KnowledgeAgentToolContext>[] =
  PUREKNOWLEDGE_ATOMIC_TOOL_SCHEMAS.map(schema =>
    defineAppTool<KnowledgeAgentToolContext>({
      ...schema,
      run: async (ctx, args, invoke) => {
        const runner = PUREKNOWLEDGE_ATOMIC_RUNNERS[schema.name]
        if (!runner) {
          throw new AgentKnowledgeToolError(
            `Missing atomic tool handler for "${schema.name}".`,
          )
        }
        return runner(ctx, args, { ...invoke, arguments: args })
      },
    }),
  )

/**
 * PureKnowledge's unified Operations Registry built on `@purescience/platform-ui/bridge/appFunctions`:
 *   - 4 composite `function` workflows (`fn_*`, always exposed)
 *   - 4 core atomic tools (always exposed)
 *   - 3 universal escape-hatch meta-tools (always exposed)
 *   - 5 extended specialist atomic tools (hidden by default, 100% reachable on demand)
 */
export const PUREKNOWLEDGE_OPERATIONS_REGISTRY =
  createAppOperationsRegistry<KnowledgeAgentToolContext>({
    appSlug: 'knowledge',
    appName: 'PureKnowledge',
    functions: PUREKNOWLEDGE_FUNCTIONS,
    tools: atomicTools,
  })

export function buildPureKnowledgeHandlers(
  getCtx: () => KnowledgeAgentToolContext,
  options: BuildHandlersOptions<KnowledgeAgentToolContext> = {},
): Record<string, AgentToolHandler> {
  const userBeforeInvoke = options.beforeInvoke
  const rawHandlers = PUREKNOWLEDGE_OPERATIONS_REGISTRY.buildHandlers(getCtx, {
    createError: message => new AgentKnowledgeToolError(message),
    ...options,
    beforeInvoke: async guard => {
      // App tool invocations do not carry a trusted organisation principal.
      // Never infer one from a model argument or from the currently visible page.
      // Organisation agents use the bound MCP and its reviewed proposal path.
      if (guard.ctx.store?.organisationId) {
        throw new AgentKnowledgeToolError(PRIVATE_ORGANISATION_ACCESS_ERROR)
      }
      await userBeforeInvoke?.(guard)
    },
  })

  return Object.fromEntries(
    Object.entries(rawHandlers).map(([name, handler]) => [
      name,
      async invoke => {
        if (getCtx().store?.organisationId) {
          throw new AgentKnowledgeToolError(PRIVATE_ORGANISATION_ACCESS_ERROR)
        }
        return handler(invoke)
      },
    ]),
  )
}
