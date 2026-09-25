import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  deletePlatformFile,
  listPlatformFiles,
  renamePlatformFile,
} from '@purescience/platform-ui/bridge/fs'
import {
  onPlatformDocumentsChanged,
  registerPlatformAppObject,
} from '@purescience/platform-ui/bridge/documents'
import {
  readTextFile,
  recordOperation,
  updateKnowledgeSettings,
  writeTextFile,
} from '../bridge/platformBridge'
import type { KnowledgeBootState } from '../types'
import {
  createKnowledgePackageManifest,
  serializeKnowledgePackageManifest,
} from '../lib/knowledgePackage'
import {
  createDefaultKnowledgeStore,
  createKnowledgePage,
  parseKnowledgeStore,
} from '../lib/knowledgeStore'
import {
  describeExternalReload,
  isKnowledgePackageChange,
  mergeExternalKnowledgeStore,
} from '../lib/knowledgeExternal'
import {
  knowledgeImportTitleFromPath,
  resolveKnowledgeManifestPath,
  resolveKnowledgeStoreFilePath,
  resolveKnowledgeWorkspaceTarget,
  resolveLegacyKnowledgePath,
} from '../lib/knowledgePaths'
import type { KnowledgeStore } from '../lib/knowledgeTypes'
import {
  KNOWLEDGE_ACTIVITY_FILE,
  KNOWLEDGE_INDEX_FILE,
  KNOWLEDGE_PAGES_DIR,
  KNOWLEDGE_PROPOSALS_FILE,
  assembleKnowledgeStore,
  parsePageFile,
  planKnowledgeWrites,
  serializeKnowledgeActivity,
  serializeKnowledgeIndex,
  serializeKnowledgeProposals,
  type KnowledgeIndexFile,
} from '../lib/knowledgePages'
import { KNOWLEDGE_APP_SLUG } from '../constants'

interface UseKnowledgeWorkspaceResult {
  store: KnowledgeStore | null
  storePath: string
  loading: boolean
  saving: boolean
  error: Error | null
  saveStore: (nextStore: KnowledgeStore) => Promise<void>
  /** One-line notice after an out-of-process change was picked up. */
  externalNotice: string | null
}

function joinPackagePath(packagePath: string, ...parts: string[]): string {
  return [packagePath.replace(/\/+$/, ''), ...parts].join('/')
}

/**
 * Apply the minimal file operations for a store transition. previous=null
 * means write everything (migration / first boot).
 */
async function writeKnowledgePages(
  packagePath: string,
  previous: KnowledgeStore | null,
  next: KnowledgeStore,
): Promise<void> {
  const plan = planKnowledgeWrites(previous, next)
  for (const write of plan.writes) {
    await writeTextFile(
      joinPackagePath(packagePath, KNOWLEDGE_PAGES_DIR, write.fileName),
      write.content,
    )
  }
  for (const fileName of plan.deletes) {
    await deletePlatformFile(
      joinPackagePath(packagePath, KNOWLEDGE_PAGES_DIR, fileName),
    ).catch(() => {})
  }
  if (plan.indexChanged) {
    await writeTextFile(
      joinPackagePath(packagePath, KNOWLEDGE_INDEX_FILE),
      serializeKnowledgeIndex(next),
    )
    await writeTextFile(
      resolveKnowledgeManifestPath(packagePath),
      serializeKnowledgePackageManifest(
        createKnowledgePackageManifest(packagePath, next),
      ),
    )
  }
  if (plan.activityChanged) {
    await writeTextFile(
      joinPackagePath(packagePath, KNOWLEDGE_ACTIVITY_FILE),
      serializeKnowledgeActivity(next.activity),
    )
  }
  if (plan.proposalsChanged) {
    await writeTextFile(
      joinPackagePath(packagePath, KNOWLEDGE_PROPOSALS_FILE),
      serializeKnowledgeProposals(next.agentChanges ?? []),
    )
  }
  await registerPlatformAppObject({
    appSlug: KNOWLEDGE_APP_SLUG,
    path: packagePath,
  })
}

async function readKnowledgePagesLayout(
  packagePath: string,
): Promise<KnowledgeStore | null> {
  let indexRaw: string
  try {
    indexRaw = await readTextFile(
      joinPackagePath(packagePath, KNOWLEDGE_INDEX_FILE),
    )
  } catch {
    return null
  }
  try {
    const index = JSON.parse(indexRaw) as KnowledgeIndexFile
    if (index.schemaVersion !== 2 || !Array.isArray(index.spaces)) return null
    const pagesDir = joinPackagePath(packagePath, KNOWLEDGE_PAGES_DIR)
    const pages = []
    try {
      const listed = await listPlatformFiles(pagesDir)
      for (const entry of listed.entries) {
        if (entry.isDirectory || !entry.name.endsWith('.md')) continue
        try {
          const page = parsePageFile(await readTextFile(entry.path))
          if (page) pages.push(page)
        } catch {
          /* one unreadable page must not take down the knowledge base */
        }
      }
    } catch {
      /* no pages dir yet */
    }
    const readJsonArray = async (fileName: string) => {
      try {
        const parsed = JSON.parse(
          await readTextFile(joinPackagePath(packagePath, fileName)),
        )
        return Array.isArray(parsed) ? parsed : []
      } catch {
        return []
      }
    }
    return assembleKnowledgeStore(
      index,
      pages,
      await readJsonArray(KNOWLEDGE_ACTIVITY_FILE),
      await readJsonArray(KNOWLEDGE_PROPOSALS_FILE),
    )
  } catch {
    return null
  }
}

export function useKnowledgeWorkspace(
  boot: KnowledgeBootState,
  resourcePath: string | null = null,
  onResourceHandled?: () => void,
): UseKnowledgeWorkspaceResult {
  // "Shell converts, app decides": a .knowledge package rebinds the
  // store; a plain .md/.txt resource is an IMPORT into the current store
  // and must never change the bound storePath.
  const { packagePath, importFilePath } = useMemo(
    () =>
      resolveKnowledgeWorkspaceTarget(
        resourcePath,
        boot.appSettings.storePath,
        boot.prefs.workingDirectory,
      ),
    [boot.appSettings.storePath, boot.prefs.workingDirectory, resourcePath],
  )
  const storePath = packagePath
  const [store, setStore] = useState<KnowledgeStore | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [externalNotice, setExternalNotice] = useState<string | null>(null)
  const [pendingImport, setPendingImport] = useState<string | null>(null)
  const previousStoreRef = useRef<KnowledgeStore | null>(null)
  const saveChainRef = useRef<Promise<void>>(Promise.resolve())
  const importedPathsRef = useRef<Set<string>>(new Set())

  // Capture the import intent before the viewport resource is cleared.
  useEffect(() => {
    if (importFilePath) setPendingImport(importFilePath)
  }, [importFilePath])

  useEffect(() => {
    let cancelled = false

    async function loadStore(): Promise<void> {
      setLoading(true)
      setError(null)
      try {
        let nextStore: KnowledgeStore | null =
          await readKnowledgePagesLayout(packagePath)
        if (!nextStore) {
          // Migration: split whichever legacy blob exists into the
          // page-per-file layout, keeping the blob as a backup.
          const storeFilePath = resolveKnowledgeStoreFilePath(packagePath)
          let migratedFromBlob = false
          try {
            nextStore = parseKnowledgeStore(await readTextFile(storeFilePath))
            migratedFromBlob = true
          } catch {
            try {
              nextStore = parseKnowledgeStore(
                await readTextFile(
                  resolveLegacyKnowledgePath(boot.prefs.workingDirectory),
                ),
              )
            } catch {
              nextStore = createDefaultKnowledgeStore()
            }
          }
          await writeKnowledgePages(packagePath, null, nextStore)
          if (migratedFromBlob) {
            await renamePlatformFile(
              storeFilePath,
              `${storeFilePath.split('/').pop()!}.pre-pages-backup`,
            ).catch(() => {})
          }
        }
        await updateKnowledgeSettings({ storePath: packagePath })
        onResourceHandled?.()
        if (!cancelled) {
          previousStoreRef.current = nextStore
          setStore(nextStore)
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError
              : new Error(String(loadError)),
          )
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void loadStore()

    return () => {
      cancelled = true
    }
  }, [boot.prefs.workingDirectory, onResourceHandled, packagePath])

  /**
   * Re-read the package after another instance's write and fold it into
   * the in-memory store. Disk wins except for strictly newer local edits
   * (kept, and named in the notice) — see mergeExternalKnowledgeStore.
   */
  const reloadFromDisk = useCallback(async (): Promise<void> => {
    const incoming = await readKnowledgePagesLayout(packagePath).catch(
      () => null,
    )
    if (!incoming) return
    const local = previousStoreRef.current
    if (!local) {
      previousStoreRef.current = incoming
      setStore(incoming)
      return
    }
    const merged = mergeExternalKnowledgeStore(local, incoming)
    previousStoreRef.current = merged.store
    setStore(merged.store)
    setExternalNotice(
      describeExternalReload(merged) ??
        'Reloaded changes made outside this window',
    )
  }, [packagePath])

  useEffect(() => {
    if (!externalNotice) return
    const timer = window.setTimeout(() => setExternalNotice(null), 8000)
    return () => window.clearTimeout(timer)
  }, [externalNotice])

  // Other instances can write this package. Coalesce its multi-file writes;
  // the shell bus already excludes writes from this instance.
  useEffect(() => {
    if (loading) return
    let timer: number | null = null
    const unsubscribe = onPlatformDocumentsChanged(change => {
      if (change.kind !== 'content') return
      if (!isKnowledgePackageChange(change.path, packagePath)) return
      if (timer) window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        timer = null
        void reloadFromDisk()
      }, 400)
    })
    return () => {
      if (timer) window.clearTimeout(timer)
      unsubscribe()
    }
  }, [loading, packagePath, reloadFromDisk])

  const saveStore = useCallback(
    async (nextStore: KnowledgeStore) => {
      const previous = previousStoreRef.current
      previousStoreRef.current = nextStore
      setStore(nextStore)
      setSaving(true)
      setError(null)
      const run = saveChainRef.current.then(async () => {
        await writeKnowledgePages(packagePath, previous, nextStore)
        await updateKnowledgeSettings({
          storePath: packagePath,
          activeSpaceId: nextStore.activeSpaceId,
          activePageId: nextStore.activePageId ?? undefined,
        })
      })
      saveChainRef.current = run.catch(() => {})
      try {
        await run
      } catch (saveError) {
        const error =
          saveError instanceof Error ? saveError : new Error(String(saveError))
        setError(error)
        throw error
      } finally {
        setSaving(false)
      }
    },
    [packagePath],
  )

  // Import an opened .md/.txt file as a new page in the CURRENT store:
  // title from the file name, body from its content. storePath is not
  // touched — the file was input, never a knowledge base.
  useEffect(() => {
    if (!pendingImport || loading) return
    if (importedPathsRef.current.has(pendingImport)) return
    importedPathsRef.current.add(pendingImport)
    const importPath = pendingImport
    setPendingImport(null)
    void (async () => {
      try {
        const body = await readTextFile(importPath)
        const current = previousStoreRef.current
        if (!current) return
        const space =
          current.spaces.find(
            candidate => candidate.id === current.activeSpaceId,
          ) ?? current.spaces[0]
        if (!space) return
        const title = knowledgeImportTitleFromPath(importPath)
        const next = createKnowledgePage(
          current,
          {
            spaceId: space.id,
            parentId: space.rootPageId,
            kind: 'wiki',
            title,
            body,
          },
          { actor: { type: 'human', name: 'You' } },
        )
        await saveStore(next)
        void recordOperation({
          lane: 'user',
          kind: 'page.import',
          appSlug: KNOWLEDGE_APP_SLUG,
          summary: `Imported "${title}" from ${importPath.split('/').pop()}`,
          refs: { path: importPath },
        }).catch(() => undefined)
      } catch (importError) {
        setError(
          importError instanceof Error
            ? importError
            : new Error(String(importError)),
        )
      } finally {
        onResourceHandled?.()
      }
    })()
  }, [loading, onResourceHandled, pendingImport, saveStore])

  return { store, storePath, loading, saving, error, saveStore, externalNotice }
}
