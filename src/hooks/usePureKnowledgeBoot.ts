import { useEffect, useState } from 'react'
import {
  fetchKnowledgeSettings,
  fetchShellPreferences,
} from '../bridge/platformBridge'
import type { KnowledgeBootState } from '../types'

interface UsePureKnowledgeBootResult {
  boot: KnowledgeBootState | null
  bootError: Error | null
  booting: boolean
}

export function usePureKnowledgeBoot(
  ready: boolean,
): UsePureKnowledgeBootResult {
  const [boot, setBoot] = useState<KnowledgeBootState | null>(null)
  const [bootError, setBootError] = useState<Error | null>(null)
  const [booting, setBooting] = useState(false)

  useEffect(() => {
    if (!ready) return

    let cancelled = false

    async function load(): Promise<void> {
      setBooting(true)
      setBootError(null)
      try {
        const [prefs, appSettings] = await Promise.all([
          fetchShellPreferences(),
          fetchKnowledgeSettings(),
        ])
        if (!cancelled) setBoot({ prefs, appSettings })
      } catch (error) {
        if (!cancelled) {
          setBoot(null)
          setBootError(
            error instanceof Error ? error : new Error(String(error)),
          )
        }
      } finally {
        if (!cancelled) setBooting(false)
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [ready])

  return { boot, bootError, booting }
}
