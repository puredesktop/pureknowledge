// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fetchOrganisationBinding,
  fetchKnowledgeSettings,
  fetchShellPreferences,
} from '../bridge/platformBridge'
import { usePureKnowledgeBoot } from './usePureKnowledgeBoot'

vi.mock('../bridge/platformBridge', () => ({
  fetchOrganisationBinding: vi.fn().mockResolvedValue(null),
  fetchKnowledgeSettings: vi.fn(),
  fetchShellPreferences: vi.fn(),
}))

const prefs = { workingDirectory: '/test', theme: 'light' as const }
const appSettings = { storePath: '/test/wiki.knowledge' }
let root: Root
let current: ReturnType<typeof usePureKnowledgeBoot>

function Harness({ ready }: { ready: boolean }) {
  current = usePureKnowledgeBoot(ready)
  return null
}

beforeEach(() => {
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
  root = createRoot(document.createElement('div'))
  vi.mocked(fetchOrganisationBinding).mockResolvedValue(null)
  vi.mocked(fetchShellPreferences).mockResolvedValue(prefs)
  vi.mocked(fetchKnowledgeSettings).mockResolvedValue(appSettings)
})

afterEach(async () => {
  await act(async () => root.unmount())
  vi.resetAllMocks()
})

describe('usePureKnowledgeBoot', () => {
  it('allows another retry when the first retry also fails', async () => {
    const firstError = new Error('Settings unavailable')
    const retryError = new Error('Settings still unavailable')
    vi.mocked(fetchKnowledgeSettings)
      .mockRejectedValueOnce(firstError)
      .mockRejectedValueOnce(retryError)

    await act(async () => root.render(createElement(Harness, { ready: true })))
    expect(current.bootError).toBe(firstError)

    await act(async () => current.retry())
    expect(current.bootError).toBe(retryError)
    expect(current.boot).toBeNull()
    expect(current.booting).toBe(false)

    await act(async () => current.retry())
    expect(current.boot).toEqual({ prefs, appSettings, organisation: null })
    expect(current.bootError).toBeNull()
    expect(current.booting).toBe(false)
    expect(fetchShellPreferences).toHaveBeenCalledTimes(3)
    expect(fetchKnowledgeSettings).toHaveBeenCalledTimes(3)
  })

  it.each(['settings', 'preferences'])(
    'recovers from a transient %s failure without changing bridge readiness',
    async failure => {
      const error = new Error('Temporarily unavailable')
      vi.mocked(
        failure === 'settings' ? fetchKnowledgeSettings : fetchShellPreferences,
      ).mockRejectedValueOnce(error)

      await act(async () => root.render(createElement(Harness, { ready: true })))
      expect(current.bootError).toBe(error)
      expect(current.boot).toBeNull()
      expect(current.booting).toBe(false)

      let resolve!: (value: typeof appSettings) => void
      vi.mocked(fetchKnowledgeSettings).mockReturnValueOnce(
        new Promise(done => {
          resolve = done
        }),
      )
      await act(async () => current.retry())
      expect(current.bootError).toBeNull()
      expect(current.booting).toBe(true)
      expect(current.boot).toBeNull()

      await act(async () => resolve(appSettings))
      expect(current.boot).toEqual({ prefs, appSettings, organisation: null })
      expect(current.bootError).toBeNull()
      expect(current.booting).toBe(false)
      expect(fetchShellPreferences).toHaveBeenCalledTimes(2)
      expect(fetchKnowledgeSettings).toHaveBeenCalledTimes(2)
    },
  )
})
