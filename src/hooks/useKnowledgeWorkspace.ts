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
  splitParentPath,
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
  saveFailed: boolean
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
    const path = joinPackagePath(packagePath, KNOWLEDGE_PAGES_DIR, fileName)
    try {
      await deletePlatformFile(path)
    } catch (cause) {
      const listed = await listPlatformFiles(
        joinPackagePath(packagePath, KNOWLEDGE_PAGES_DIR),
      )
      if (listed.entries.some(entry => entry.name === fileName)) throw cause
    }
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

/** A failed read is missing only when a directory listing confirms it. */
async function readOptionalFile(path: string): Promise<string | null> {
  try {
    return await readTextFile(path)
  } catch (cause) {
    const { parent, name } = splitParentPath(path)
    try {
      const listed = await listPlatformFiles(parent)
      if (!listed.entries.some(entry => entry.name === name)) return null
    } catch {
      // A new package may not exist yet. Confirm that in its parent rather
      // than treating access or transport failures as an empty knowledge base.
      const ancestor = splitParentPath(parent)
      try {
        const listed = await listPlatformFiles(ancestor.parent)
        if (!listed.entries.some(entry => entry.name === ancestor.name))
          return null
      } catch {
        /* Unknown is not missing. */
      }
    }
    throw cause
  }
}

async function readKnowledgePagesLayout(
  packagePath: string,
): Promise<KnowledgeStore | null> {
  const indexPath = joinPackagePath(packagePath, KNOWLEDGE_INDEX_FILE)
  const indexRaw = await readOptionalFile(indexPath)
  if (indexRaw === null) return null
  const index = JSON.parse(indexRaw) as KnowledgeIndexFile
  if (
    index.schemaVersion !== 2 ||
    !Array.isArray(index.spaces) ||
    !index.spaces.length ||
    index.spaces.some(
      space =>
        !space ||
        typeof space.id !== 'string' ||
        typeof space.name !== 'string',
    )
  )
    throw new Error(`Invalid knowledge index: ${indexPath}`)
  const pagesDir = joinPackagePath(packagePath, KNOWLEDGE_PAGES_DIR)
  const listed = await listPlatformFiles(pagesDir)
  const entries = listed.entries.filter(
    entry => !entry.isDirectory && entry.name.endsWith('.md'),
  )
  const pages = new Array<NonNullable<ReturnType<typeof parsePageFile>>>(
    entries.length,
  )
  let cursor = 0
  // Bound bridge traffic while overlapping independent page reads. Keep the
  // listing order deterministic, including duplicate-identity recovery.
  const readPages = async () => {
    while (cursor < entries.length) {
      const position = cursor++
      const entry = entries[position]!
      const page = parsePageFile(await readTextFile(entry.path))
      if (!page) throw new Error(`Invalid knowledge page: ${entry.path}`)
      pages[position] = page
    }
  }
  const readJsonArray = async (fileName: string) => {
    const path = joinPackagePath(packagePath, fileName)
    const raw = await readOptionalFile(path)
    if (raw === null) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed))
      throw new Error(`Invalid knowledge history: ${path}`)
    return parsed
  }
  const [, activity, proposals] = await Promise.all([
    Promise.all(Array.from({ length: Math.min(8, entries.length) }, readPages)),
    readJsonArray(KNOWLEDGE_ACTIVITY_FILE),
    readJsonArray(KNOWLEDGE_PROPOSALS_FILE),
  ])
  return assembleKnowledgeStore(index, pages, activity, proposals)
}

export function useKnowledgeWorkspace(
  boot: KnowledgeBootState,
  resourcePath: string | null = null,
  onResourceHandled?: () => void,
): UseKnowledgeWorkspaceResult {
  // "Shell converts, app decides": a .knowledge package rebinds the
  // store; a plain .md/.txt resource is an IMPORT into the current store
  // and must never change the bound storePath.
  const boundPackageRef = useRef(boot.appSettings.storePath)
  const { packagePath, importFilePath } = useMemo(() => {
    const target = resolveKnowledgeWorkspaceTarget(
      resourcePath,
      boundPackageRef.current ?? boot.appSettings.storePath,
      boot.prefs.workingDirectory,
    )
    // Clearing a handled resource is not an instruction to reopen the boot
    // package. Imports likewise belong to the currently bound knowledge base.
    if (resourcePath && !target.importFilePath)
      boundPackageRef.current = target.packagePath
    return target
  }, [boot.appSettings.storePath, boot.prefs.workingDirectory, resourcePath])
  const storePath = packagePath
  const [store, setStore] = useState<KnowledgeStore | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveFailed, setSaveFailed] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [externalNotice, setExternalNotice] = useState<string | null>(null)
  const [pendingImport, setPendingImport] = useState<string | null>(null)
  const workspaceRef = useRef<{
    path: string
    local: KnowledgeStore | null
    durable: KnowledgeStore | null
    pending: number
    revision: number
    reload: number
  } | null>(null)
  if (workspaceRef.current?.path !== packagePath) {
    workspaceRef.current = {
      path: packagePath,
      local: null,
      durable: null,
      pending: 0,
      revision: 0,
      reload: 0,
    }
  }
  const workspace = workspaceRef.current
  const handledRef = useRef(onResourceHandled)
  handledRef.current = onResourceHandled
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
      setStore(null)
      setSaving(false)
      setSaveFailed(false)
      setExternalNotice(null)
      try {
        await saveChainRef.current
        if (cancelled) return
        let nextStore: KnowledgeStore | null = await readKnowledgePagesLayout(
          packagePath,
        )
        if (!nextStore) {
          // Migration: split whichever legacy blob exists into the
          // page-per-file layout, keeping the blob as a backup.
          const storeFilePath = resolveKnowledgeStoreFilePath(packagePath)
          const blob = await readOptionalFile(storeFilePath)
          const legacy =
            blob === null
              ? await readOptionalFile(
                  resolveLegacyKnowledgePath(boot.prefs.workingDirectory),
                )
              : null
          if (blob !== null || legacy !== null) {
            const raw = blob ?? legacy!
            const parsed = JSON.parse(raw) as Partial<KnowledgeStore>
            if (
              parsed.schemaVersion !== 1 ||
              !Array.isArray(parsed.pages) ||
              !Array.isArray(parsed.spaces)
            )
              throw new Error(
                'Invalid legacy knowledge store. The original file has been kept.',
              )
            nextStore = parseKnowledgeStore(raw)
          } else nextStore = createDefaultKnowledgeStore()
          const migratedFromBlob = blob !== null
          if (cancelled) return
          await writeKnowledgePages(packagePath, null, nextStore)
          if (migratedFromBlob) {
            await renamePlatformFile(
              storeFilePath,
              `${storeFilePath.split('/').pop()!}.pre-pages-backup`,
            ).catch(() => {})
          }
        }
        if (cancelled) return
        await updateKnowledgeSettings({ storePath: packagePath })
        if (cancelled) return
        if (!importFilePath) handledRef.current?.()
        if (!cancelled) {
          workspace.local = nextStore
          workspace.durable = nextStore
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
  }, [boot.prefs.workingDirectory, packagePath, workspace])

  /**
   * Re-read the package after another instance's write and fold it into
   * the in-memory store. Disk wins except for strictly newer local edits
   * (kept, and named in the notice) — see mergeExternalKnowledgeStore.
   */
  const reloadFromDisk = useCallback(async (): Promise<void> => {
    const request = ++workspace.reload
    await saveChainRef.current
    const revision = workspace.revision
    try {
      const incoming = await readKnowledgePagesLayout(packagePath)
      if (
        workspaceRef.current !== workspace ||
        request !== workspace.reload ||
        !incoming
      )
        return
      // A save queued during the read must finish before checking disk again;
      // an older read must never become that save's durable baseline.
      if (revision !== workspace.revision) {
        void reloadFromDisk()
        return
      }
      const merged = workspace.local
        ? mergeExternalKnowledgeStore(
            workspace.local,
            incoming,
            workspace.durable,
          )
        : null
      workspace.durable = incoming
      workspace.local = merged?.store ?? incoming
      setStore(workspace.local)
      setExternalNotice(
        merged
          ? describeExternalReload(merged) ??
              'Reloaded changes made outside this window'
          : null,
      )
    } catch (cause) {
      if (workspaceRef.current === workspace && request === workspace.reload)
        setError(cause instanceof Error ? cause : new Error(String(cause)))
    }
  }, [packagePath, workspace])

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
      if (workspaceRef.current !== workspace || !workspace.local)
        throw new Error('The knowledge workspace is not ready to save.')
      workspace.local = nextStore
      ++workspace.revision
      ++workspace.pending
      setStore(nextStore)
      setSaving(true)
      setError(null)
      const run = saveChainRef.current.then(async () => {
        // Diff against acknowledged disk state, never optimistic UI state.
        await writeKnowledgePages(packagePath, workspace.durable, nextStore)
        workspace.durable = nextStore
        if (workspaceRef.current === workspace)
          await updateKnowledgeSettings({
            storePath: packagePath,
            activeSpaceId: nextStore.activeSpaceId,
            activePageId: nextStore.activePageId ?? undefined,
          })
      })
      saveChainRef.current = run.catch(() => {})
      try {
        await run
        if (workspaceRef.current === workspace && workspace.pending === 1) {
          setError(null)
          setSaveFailed(false)
        }
      } catch (saveError) {
        const error =
          saveError instanceof Error ? saveError : new Error(String(saveError))
        if (workspaceRef.current === workspace) {
          setError(error)
          setSaveFailed(true)
        }
        throw error
      } finally {
        --workspace.pending
        if (workspaceRef.current === workspace) setSaving(workspace.pending > 0)
      }
    },
    [packagePath, workspace],
  )

  // Import an opened .md/.txt file as a new page in the CURRENT store:
  // title from the file name, body from its content. storePath is not
  // touched — the file was input, never a knowledge base.
  useEffect(() => {
    if (!pendingImport || loading || !workspace.local) return
    const importKey = `${packagePath}:${pendingImport}`
    if (importedPathsRef.current.has(importKey)) return
    importedPathsRef.current.add(importKey)
    const importPath = pendingImport
    setPendingImport(null)
    void (async () => {
      try {
        const body = await readTextFile(importPath)
        if (workspaceRef.current !== workspace) return
        const current = workspace.local
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
        importedPathsRef.current.delete(importKey)
        if (workspaceRef.current !== workspace) return
        setError(
          importError instanceof Error
            ? importError
            : new Error(String(importError)),
        )
      } finally {
        if (workspaceRef.current === workspace) handledRef.current?.()
      }
    })()
  }, [loading, packagePath, pendingImport, saveStore, workspace])

  return {
    store: workspace.local ? store : null,
    storePath,
    loading,
    saving,
    error,
    saveFailed,
    saveStore,
    externalNotice,
  }
}
