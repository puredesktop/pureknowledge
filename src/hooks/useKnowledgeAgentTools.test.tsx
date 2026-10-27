// @vitest-environment happy-dom
import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { useKnowledgeAgentTools } from './useKnowledgeAgentTools'
import {
  GuidanceDetails,
  GuidanceSearchDetails,
  GuidanceStatusFilter,
} from '../components/KnowledgeGuidance'
import {
  createDefaultKnowledgeStore,
  createKnowledgePage,
  createKnowledgeSpace,
  rankKnowledgePages,
  updateKnowledgePage,
} from '../lib/knowledgeStore'
import { guidanceMetadata, type GuidanceFilter } from '../lib/knowledgeGuidance'
import type { KnowledgeAgentToolContext } from '../agents/catalog'

const registration = vi.hoisted(() => ({
  current: null as null | {
    handlers: Record<
      string,
      (invoke: {
        arguments?: Record<string, unknown>
      }) => Promise<{ content: string }>
    >
  },
}))
vi.mock('@purescience/platform-ui/bridge/react/usePlatformAgentTools', () => ({
  usePlatformAgentTools: (
    options: NonNullable<typeof registration.current>,
  ) => {
    registration.current = options
  },
}))
vi.mock('../bridge/platformBridge', () => ({
  recordOperation: vi.fn(async () => undefined),
}))

it('registers matching page/context/search reads and renders their metadata and every search filter without mutation', async () => {
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
  let store = createDefaultKnowledgeStore()
  const spaceId = store.activeSpaceId
  const ids: Record<string, string> = {}
  for (const status of ['unmarked', 'draft', 'current', 'retired'] as const) {
    store = createKnowledgePage(store, {
      spaceId,
      kind: 'wiki',
      title: `Guide ${status}`,
      body: 'Retained content',
    })
    ids[status] = store.activePageId!
    if (status !== 'unmarked')
      store = updateKnowledgePage(store, store.activePageId!, {
        guidanceStatus: status,
      })
  }
  const oldId = ids.retired!
  const check = {
    actorType: 'human' as const,
    actorName: 'You',
    at: '2026-10-01T00:00:00.000Z',
  }
  store = updateKnowledgePage(store, oldId, {
    lastChecked: check,
    replacementPageId: ids.current!,
  })
  store = createKnowledgeSpace(store, { name: 'Other space' })
  store = createKnowledgePage(store, {
    spaceId: store.activeSpaceId,
    kind: 'wiki',
    title: 'Guide foreign space',
    body: 'Other context',
  })
  const otherId = store.activePageId!
  store = { ...store, activePageId: oldId, activeSpaceId: spaceId }
  const snapshot = JSON.stringify(store)
  const context: KnowledgeAgentToolContext = {
    store,
    storePath: '/fixture.knowledge',
    saveStore: vi.fn(),
  }
  const host = document.createElement('div'),
    portal = document.createElement('div')
  portal.id = 'platform-menu-portal'
  document.body.append(host, portal)
  const root = createRoot(host)
  const old = store.pages.find((page) => page.id === oldId)!
  function Harness() {
    useKnowledgeAgentTools(true, context)
    const [status, setStatus] = useState<GuidanceFilter>('all')
    const hits = rankKnowledgePages(
      {
        ...store,
        pages: store.pages.filter((page) => page.spaceId === spaceId),
      },
      'Guide',
      50,
      status,
    )
    return (
      <>
        <GuidanceDetails
          page={old}
          store={store}
          onSave={() => undefined}
          onSelectPage={() => undefined}
        />
        <GuidanceStatusFilter value={status} onChange={setStatus} />
        <div aria-label="Results">
          {hits.map((hit) => (
            <div data-page-id={hit.page.id} key={hit.page.id}>
              <GuidanceSearchDetails page={hit.page} store={store} />
            </div>
          ))}
        </div>
      </>
    )
  }
  try {
    await act(async () => {
      root.render(<Harness />)
    })
    const handlers = registration.current!.handlers
    const parsed = async (name: string, args: Record<string, unknown> = {}) =>
      JSON.parse((await handlers[name]!({ arguments: args })).content)
    const metadata = guidanceMetadata(old)
    expect((await parsed('getKnowledgeContext')).activePage).toMatchObject(
      metadata,
    )
    expect(await parsed('readKnowledgePage', { page: oldId })).toMatchObject(
      metadata,
    )
    expect(host.textContent).toContain('Retired guidance')
    expect(host.textContent).toContain('Last checked by You')
    expect(host.textContent).toContain('2026')
    expect(host.textContent).toContain('Open replacement: Guide current')
    for (const [filter, label] of [
      ['all', 'All pages'],
      ['draft', 'Draft'],
      ['current', 'Current'],
      ['retired', 'Retired'],
      ['unmarked', 'Unmarked'],
    ]) {
      const trigger = host.querySelector<HTMLButtonElement>(
        'button[aria-label^="Status filter:"]',
      )!
      await act(async () => {
        trigger.click()
      })
      const item = Array.from(
        portal.querySelectorAll<HTMLElement>('[role="menuitem"]'),
      ).find((item) => item.textContent?.trim() === label)!
      expect(item).toBeTruthy()
      await act(async () => {
        item.click()
      })
      const results = await parsed('searchKnowledge', {
        space: spaceId,
        query: 'Guide',
        status: filter,
        limit: 25,
      })
      const uiIds = Array.from(host.querySelectorAll('[data-page-id]')).map(
        (node) => node.getAttribute('data-page-id'),
      )
      expect(uiIds).toEqual(
        results.pages.map((page: { id: string }) => page.id),
      )
      expect(uiIds).not.toContain(otherId)
      if (filter === 'retired') {
        expect(results.pages).toEqual([
          expect.objectContaining({ id: oldId, ...metadata }),
        ])
        expect(
          host.querySelector('[aria-label="Results"]')?.textContent,
        ).toContain('Retired · Checked by You')
      }
    }
    expect(JSON.stringify(store)).toBe(snapshot)
    expect(context.saveStore).not.toHaveBeenCalled()
  } finally {
    await act(async () => root.unmount())
    host.remove()
    portal.remove()
  }
})
