import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { embedTexts, getEmbeddingStatus, setupEmbeddings, type EmbeddingStatus } from '@purescience/platform-ui/bridge/embeddings'
import { readTextFile, writeTextFile } from '../bridge/platformBridge'
import { KNOWLEDGE_SEARCH_INDEX_FILE } from '../lib/organisationKnowledge.mjs'
import {
  MEANING_MIN_QUERY,
  parseKnowledgeSearchIndex,
  planKnowledgeSearchUpdate,
  serializeKnowledgeSearchIndex,
  updateKnowledgeSearchIndex,
  type KnowledgeMeaning,
  type KnowledgeMeaningReadiness,
  type KnowledgeSearchIndex,
} from '../lib/knowledgeMeaning'
import type { KnowledgeStore } from '../lib/knowledgeTypes'

const DOWNLOAD_POLL_MS = 1_000
const STATUS_POLL_MS = 30_000
const UPDATE_DELAY_MS = 1_500
const SAVE_EVERY_MS = 5_000
const CACHED_QUESTIONS = 50

export interface UseKnowledgeMeaningResult extends KnowledgeMeaning {
  state: KnowledgeMeaningReadiness
  /** Asks the person, in the shell's own dialog, to download the model. */
  setUp: () => Promise<void>
  /** After a failure, read the pages again. */
  retry: () => void
}

function readinessFrom(status: EmbeddingStatus): KnowledgeMeaningReadiness {
  const sizes = { totalBytes: status.model?.totalBytes, receivedBytes: status.model?.receivedBytes }
  switch (status.state) {
    case 'ready':
      return { state: 'indexing', ...sizes }
    case 'downloading':
      return { state: 'downloading', ...sizes }
    case 'unsupported':
      return { state: 'unsupported', error: status.error }
    case 'failed':
      return { state: 'failed', error: status.error, ...sizes }
    default:
      return { state: 'absent', ...sizes }
  }
}

/**
 * Keeps this library's search index current and answers questions against it. Nothing runs until the model is on the
 * computer and the person agreed to it; until then search stays by words, and `state` lets the app say so.
 */
export function useKnowledgeMeaning(store: KnowledgeStore | null, storePath: string): UseKnowledgeMeaningResult {
  const [status, setStatus] = useState<EmbeddingStatus | null>(null)
  const [progress, setProgress] = useState<{ indexed: number; total: number; settled: boolean } | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const indexRef = useRef<{ path: string; index: KnowledgeSearchIndex } | null>(null)
  const questions = useRef(new Map<string, Promise<number[] | null>>())
  const pagesRef = useRef(store?.pages ?? [])
  pagesRef.current = store?.pages ?? []

  const checkStatus = useCallback(async () => {
    const next = await getEmbeddingStatus()
    setStatus(next)
    return next
  }, [])
  const downloading = status?.state === 'downloading'
  useEffect(() => {
    void checkStatus()
    const timer = setInterval(() => void checkStatus(), downloading ? DOWNLOAD_POLL_MS : STATUS_POLL_MS)
    const onFocus = () => void checkStatus()
    window.addEventListener('focus', onFocus)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [checkStatus, downloading])

  const modelId = status?.available ? status.model?.id : undefined
  const dimensions = status?.model?.dimensions
  const filePath = `${storePath.replace(/\/+$/, '')}/${KNOWLEDGE_SEARCH_INDEX_FILE}`

  // What to index now. A removed model loses nothing: the saved index works again when it returns.
  const target = useRef<{ filePath: string; modelId: string; dimensions: number } | null>(null)
  target.current = modelId && dimensions ? { filePath, modelId, dimensions } : null
  const running = useRef(false)
  const again = useRef(false)
  const refresh = useCallback(async () => {
    if (running.current) {
      again.current = true
      return
    }
    running.current = true
    try {
      do {
        again.current = false
        const goal = target.current
        if (!goal) return
        if (indexRef.current?.path !== goal.filePath || indexRef.current.index.modelId !== goal.modelId) {
          const raw = await readTextFile(goal.filePath).catch(() => null)
          indexRef.current = { path: goal.filePath, index: parseKnowledgeSearchIndex(raw, goal.modelId, goal.dimensions) }
        }
        const latest = pagesRef.current
        const plan = planKnowledgeSearchUpdate(indexRef.current.index, latest)
        const indexed = plan.totalPassages - plan.missingPassages
        if (!plan.work.length && !plan.removed.length) {
          setProgress({ indexed, total: plan.totalPassages, settled: true })
          setFailure(null)
          continue
        }
        setProgress({ indexed, total: plan.totalPassages, settled: false })
        let savedAt = Date.now()
        const result = await updateKnowledgeSearchIndex(
          indexRef.current.index,
          latest,
          async texts => (await embedTexts({ texts, purpose: 'passage' })).vectors,
          {
            shouldStop: () => target.current?.filePath !== goal.filePath || target.current.modelId !== goal.modelId,
            onProgress: async (index, done) => {
              indexRef.current = { path: goal.filePath, index }
              setProgress({ indexed: indexed + done.embedded, total: plan.totalPassages, settled: false })
              if (Date.now() - savedAt > SAVE_EVERY_MS) {
                savedAt = Date.now()
                await writeTextFile(goal.filePath, serializeKnowledgeSearchIndex(index))
              }
            },
          },
        )
        indexRef.current = { path: goal.filePath, index: result.index }
        await writeTextFile(goal.filePath, serializeKnowledgeSearchIndex(result.index))
        if (result.stopped) {
          again.current = true
          continue
        }
        setProgress({ indexed: plan.totalPassages, total: plan.totalPassages, settled: true })
        setFailure(null)
      } while (again.current)
    } catch (cause) {
      // Finished pages stay in the index; the rest are matched by words, and the app says search stopped.
      console.error('[pureknowledge] search index update failed:', cause instanceof Error ? cause.message.slice(0, 300) : '')
      setFailure(cause instanceof Error ? cause.message : String(cause))
    } finally {
      running.current = false
    }
  }, [])
  const pages = store?.pages
  useEffect(() => {
    if (!modelId || !dimensions || !pages) return
    const timer = setTimeout(() => void refresh(), indexRef.current ? UPDATE_DELAY_MS : 0)
    return () => clearTimeout(timer)
  }, [attempt, dimensions, filePath, modelId, pages, refresh])
  useEffect(() => () => { target.current = null }, [])

  const state = useMemo<KnowledgeMeaningReadiness>(() => {
    if (!status) return { state: 'checking' }
    const base = readinessFrom(status)
    if (base.state !== 'indexing') return base
    if (failure) return { ...base, state: 'failed', error: 'It could not read every page.', indexed: progress?.indexed, total: progress?.total }
    if (!progress) return { ...base, indexed: 0, total: 0 }
    return { ...base, state: progress.settled ? 'ready' : 'indexing', indexed: progress.indexed, total: progress.total }
  }, [failure, progress, status])
  const stateRef = useRef(state)
  stateRef.current = state

  const vector = useCallback(async (query: string): Promise<number[] | null> => {
    const text = query.trim()
    if (text.length < MEANING_MIN_QUERY || !modelId) return null
    const known = questions.current.get(text)
    if (known) return known
    const asked = embedTexts({ texts: [text], purpose: 'query' }).then(result => result.vectors[0] ?? null).catch(() => {
      questions.current.delete(text)
      return null
    })
    questions.current.set(text, asked)
    if (questions.current.size > CACHED_QUESTIONS) questions.current.delete(questions.current.keys().next().value as string)
    return asked
  }, [modelId])

  const setUp = useCallback(async () => {
    setStatus(await setupEmbeddings())
  }, [])
  const retry = useCallback(() => {
    setFailure(null)
    setAttempt(value => value + 1)
  }, [])
  return {
    state,
    setUp,
    retry,
    vector,
    readiness: useCallback(() => stateRef.current, []),
    index: useCallback(() => (indexRef.current?.path === filePath ? indexRef.current.index : null), [filePath]),
  }
}
