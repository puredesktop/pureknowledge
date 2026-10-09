import {
  agentToolErrorContent,
  formatAgentToolJson,
} from '@purescience/platform-ui/bridge/agentToolHelpers'
import {
  assistantRoot,
  rememberAssistantFact,
} from '../lib/personalAssistantMemory'
import { pageFileName } from '../lib/knowledgePages'
import { recordOperation } from '../bridge/platformBridge'
import type { KnowledgeAgentToolContext } from './catalog'
export async function personalAssistantMemoryHandler(
  context: KnowledgeAgentToolContext,
  args: Record<string, unknown>,
) {
  try {
    if (!context.store)
      throw new Error('Knowledge is still loading; retry shortly.')
    const path = (page: Parameters<typeof pageFileName>[0]) =>
      `${context.storePath}/pages/${pageFileName(page)}`
    if (args.action === 'remember') {
      const result = rememberAssistantFact(
        context.store,
        args as {
          title: string
          body: string
          summary: string
          expectedUpdatedAt?: string
        },
      )
      if (!result.unchanged) {
        await context.saveStore(result.store)
        void recordOperation({
          lane: 'agent',
          kind: 'knowledge.personal-assistant-memory',
          appSlug: 'pureknowledge',
          summary: String(args.summary),
          detail: result.page.title,
        }).catch(() => undefined)
      }
      return {
        content: formatAgentToolJson({
          rootId: result.root.id,
          pageId: result.page.id,
          updatedAt: result.page.updatedAt,
          artifactPaths: [path(result.page)],
          unchanged: result.unchanged,
          saved: true,
        }),
      }
    }
    if (args.action !== 'read') throw new Error('Choose read or remember.')
    const root = assistantRoot(context.store)
    return {
      content: formatAgentToolJson({
        root: root
          ? { id: root.id, title: root.title, path: path(root) }
          : null,
        entries: root
          ? context.store.pages
              .filter(page => page.parentId === root.id)
              .slice(0, 30)
              .map(page => ({
                id: page.id,
                title: page.title,
                updatedAt: page.updatedAt,
                body: page.body.slice(0, 400),
                truncated: page.body.length > 400,
                path: path(page),
              }))
          : [],
        note: 'Read full pages with readKnowledgePage if truncated. Only remember facts the user wants retained; no credentials.',
      }),
    }
  } catch (error) {
    return agentToolErrorContent(
      error instanceof Error ? error.message : String(error),
    )
  }
}
