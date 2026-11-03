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
import type {
  KnowledgeActivity,
  KnowledgeAgentChange,
  KnowledgePage,
  KnowledgeStore,
} from '../lib/knowledgeTypes'
import {
  KNOWLEDGE_ACTIVITY_FILE,
  KNOWLEDGE_INDEX_FILE,
  KNOWLEDGE_PAGES_DIR,
  KNOWLEDGE_PROPOSALS_FILE,
  assembleKnowledgeStore,
  latestKnowledgePages,
  pageFileName,
  parsePageFile,
  planKnowledgeWrites,
  serializePageFile,
  serializeKnowledgeActivity,
  serializeKnowledgeIndex,
  serializeKnowledgeProposals,
  type KnowledgeIndexFile,
} from '../lib/knowledgePages'
import { KNOWLEDGE_APP_SLUG } from '../constants'
import { KNOWLEDGE_SEARCH_INDEX_FILE, validateOrganisationLibrary } from '../lib/organisationKnowledge.mjs'
import { withKnowledgeWriter } from '../bridge/writerLease'
import {
  foldSavedStore,
  keptKnowledgePage,
  keptPageTitle,
  mergeActivity,
  mergeProposals,
  mergeSpaces,
  pageFileSuffix,
  resolvePageSave,
} from '../lib/knowledgeSaveMerge'

export type KnowledgeStoreUpdate =
  | KnowledgeStore
  | ((current: KnowledgeStore) => KnowledgeStore)

interface UseKnowledgeWorkspaceResult {
  store: KnowledgeStore | null
  storePath: string
  loading: boolean
  saving: boolean
  error: Error | null
  saveFailed: boolean
  saveStore: (nextStore: KnowledgeStoreUpdate) => Promise<void>
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

interface PackageSaveResult {
  store: KnowledgeStore
  /** What the person must be told: words kept as a page of their own. */
  notices: string[]
  /** Something else changed on disk since this copy last looked: read the package again. */
  arrivals: boolean
}

/**
 * Save what this copy changed since it last agreed with the package. A copy never writes what it holds: every page and
 * side file it changed is merged with the file as it is now (lib/knowledgeSaveMerge.ts), one writer at a time.
 */
async function saveKnowledgePackage(
  packagePath: string,
  durable: KnowledgeStore,
  next: KnowledgeStore,
  heldCopy: boolean,
): Promise<PackageSaveResult> {
  const baseById = new Map(durable.pages.map(page => [page.id, page]))
  const nextIds = new Set(next.pages.map(page => page.id))
  const changed = next.pages.filter(page => baseById.get(page.id) !== page)
  const removed = durable.pages.filter(page => !nextIds.has(page.id))
  const spacesChanged = durable.spaces !== next.spaces
  // Where the person is, in the file every copy shares. A held copy looking around must not move it.
  const placeChanged =
    (!heldCopy || removed.length > 0) &&
    (durable.activeSpaceId !== next.activeSpaceId ||
      durable.activePageId !== next.activePageId)
  const activityChanged = durable.activity !== next.activity
  const proposalsChanged = (durable.agentChanges ?? []) !== (next.agentChanges ?? [])
  if (
    !changed.length &&
    !removed.length &&
    !spacesChanged &&
    !placeChanged &&
    !activityChanged &&
    !proposalsChanged
  )
    return { store: next, notices: [], arrivals: false }

  return withKnowledgeWriter(async () => {
    const pagesDir = joinPackagePath(packagePath, KNOWLEDGE_PAGES_DIR)
    const listed = (await listPagesOfPackage(packagePath)).filter(
      entry => !entry.isDirectory && entry.name.endsWith('.md'),
    )
    const filesOf = (id: string) => {
      const suffix = pageFileSuffix(id)
      return listed.filter(entry => entry.name.endsWith(suffix))
    }
    const readDisk = async (id: string): Promise<KnowledgePage | null> => {
      const pages: KnowledgePage[] = []
      for (const entry of filesOf(id)) {
        const raw = await readOptionalFile(entry.path)
        const page = raw === null ? null : parsePageFile(raw)
        if (page?.id === id) pages.push(page)
      }
      return latestKnowledgePages(pages)[0] ?? null
    }
    const removeFiles = async (id: string, except?: string) => {
      for (const entry of filesOf(id)) {
        if (entry.name === except) continue
        await deletePlatformFile(entry.path).catch(async cause => {
          const after = await listPlatformFiles(pagesDir)
          if (after.entries.some(file => file.name === entry.name)) throw cause
        })
      }
    }

    const at = new Date().toISOString()
    const settled = new Map(next.pages.map(page => [page.id, page]))
    const kept: Array<{ from: KnowledgePage; body: string; deleted: boolean }> = []
    for (const mine of changed) {
      const outcome = resolvePageSave({ base: baseById.get(mine.id), mine, disk: await readDisk(mine.id) })
      if (outcome.keep !== undefined) kept.push({ from: mine, body: outcome.keep, deleted: outcome.kind === 'gone' })
      if (outcome.kind === 'gone') {
        settled.delete(mine.id)
        await removeFiles(mine.id)
        continue
      }
      settled.set(mine.id, outcome.page)
      if (outcome.kind === 'write') {
        await writeTextFile(joinPackagePath(pagesDir, pageFileName(outcome.page)), serializePageFile(outcome.page))
      }
      // A slug change moves the file. Only one file stays, so the page can never come back from an old one.
      await removeFiles(mine.id, pageFileName(outcome.page))
    }
    for (const base of removed) {
      const disk = await readDisk(base.id)
      // Deleted here from a view older than the file: the words this copy never saw are kept.
      if (disk && disk.body.trim() !== base.body.trim()) kept.push({ from: disk, body: disk.body, deleted: true })
      await removeFiles(base.id)
    }
    const pageIds = new Set(settled.keys())
    const keptPages = kept.map(({ from, body }) =>
      keptKnowledgePage({
        from,
        body,
        at,
        id: `page-${crypto.randomUUID()}`,
        parentId: from.parentId && pageIds.has(from.parentId)
          ? from.parentId
          : next.spaces.find(space => space.id === from.spaceId)?.rootPageId ?? null,
      }),
    )
    for (const page of keptPages)
      await writeTextFile(joinPackagePath(pagesDir, pageFileName(page)), serializePageFile(page))

    let spaces = next.spaces
    if (spacesChanged || placeChanged) {
      const indexRaw = await readOptionalFile(joinPackagePath(packagePath, KNOWLEDGE_INDEX_FILE))
      const disk = indexRaw === null ? null : parseIndexQuietly(indexRaw)
      if (disk) {
        const merged = mergeSpaces(durable.spaces, next.spaces, disk.spaces)
        if (JSON.stringify(merged) !== JSON.stringify(next.spaces)) spaces = merged
      }
    }
    const nextPages = [...keptPages, ...next.pages.flatMap(page => {
      const settledPage = settled.get(page.id)
      return settledPage ? [settledPage] : []
    })]
    const activePageId = next.activePageId && !pageIds.has(next.activePageId)
      ? nextPages.find(page => page.spaceId === next.activeSpaceId)?.id ?? null
      : next.activePageId

    let activity = next.activity
    if (keptPages.length)
      activity = [
        ...keptPages.map((page): KnowledgeActivity => ({
          id: `activity-${crypto.randomUUID()}`,
          pageId: page.id,
          at,
          type: 'page.created',
          text: `Kept ${page.title}`,
        })),
        ...activity,
      ]
    if (activityChanged || keptPages.length) {
      const disk = await readJsonArrayQuietly<KnowledgeActivity>(joinPackagePath(packagePath, KNOWLEDGE_ACTIVITY_FILE))
      const known = new Set(activity.map(item => item.id))
      if (disk.some(item => !known.has(item.id))) activity = mergeActivity(activity, disk)
      await writeTextFile(joinPackagePath(packagePath, KNOWLEDGE_ACTIVITY_FILE), serializeKnowledgeActivity(activity))
    }
    let agentChanges = next.agentChanges ?? []
    if (proposalsChanged) {
      const disk = await readJsonArrayQuietly<KnowledgeAgentChange>(joinPackagePath(packagePath, KNOWLEDGE_PROPOSALS_FILE))
      const merged = mergeProposals(agentChanges, disk)
      if (JSON.stringify(merged) !== JSON.stringify(agentChanges)) agentChanges = merged
      await writeTextFile(joinPackagePath(packagePath, KNOWLEDGE_PROPOSALS_FILE), serializeKnowledgeProposals(agentChanges))
    }

    const store: KnowledgeStore = { ...next, pages: nextPages, spaces, activity, agentChanges, activePageId }
    const settledAsAsked =
      !keptPages.length &&
      nextPages.length === next.pages.length &&
      nextPages.every((page, index) => page === next.pages[index]) &&
      spaces === next.spaces &&
      activity === next.activity &&
      agentChanges === (next.agentChanges ?? []) &&
      activePageId === next.activePageId
    if (spacesChanged || placeChanged) {
      const indexPath = joinPackagePath(packagePath, KNOWLEDGE_INDEX_FILE)
      const place = heldCopy ? parseIndexQuietly((await readOptionalFile(indexPath)) ?? '') : null
      const placeStands = place && !removed.some(page => page.id === place.activePageId)
      await writeTextFile(
        indexPath,
        serializeKnowledgeIndex(place && placeStands ? { ...store, activeSpaceId: place.activeSpaceId ?? store.activeSpaceId, activePageId: place.activePageId } : store),
      )
      await writeTextFile(
        resolveKnowledgeManifestPath(packagePath),
        serializeKnowledgePackageManifest(createKnowledgePackageManifest(packagePath, store)),
      )
    }
    await registerPlatformAppObject({ appSlug: KNOWLEDGE_APP_SLUG, path: packagePath })

    // A page file this copy has never heard of, or a page it holds with no file: read the package again.
    const suffixOf = (name: string) => name.slice(name.lastIndexOf('-'))
    const known = new Set([...baseById.keys(), ...nextIds].map(pageFileSuffix))
    const present = new Set(listed.map(entry => suffixOf(entry.name)))
    const arrivals =
      [...present].some(suffix => !known.has(suffix)) ||
      durable.pages.some(page => nextIds.has(page.id) && !present.has(pageFileSuffix(page.id)))
    return {
      store: settledAsAsked ? next : store,
      arrivals,
      notices: kept.map(({ from, deleted }) => {
        const title = keptPageTitle(from.title, at)
        return deleted
          ? `“${from.title}” was deleted in another window. The words it still held are kept as “${title}”.`
          : `“${from.title}” was changed in another window too. The older words are kept as “${title}”.`
      }),
    }
  })
}

/** The package's page files. No listing is not no pages: only a package with no pages folder has none. */
async function listPagesOfPackage(packagePath: string) {
  try {
    return (await listPlatformFiles(joinPackagePath(packagePath, KNOWLEDGE_PAGES_DIR))).entries
  } catch (cause) {
    const root = await listPlatformFiles(packagePath).catch(() => null)
    if (root && !root.entries.some(entry => entry.name === KNOWLEDGE_PAGES_DIR)) return []
    throw cause
  }
}

function parseIndexQuietly(raw: string): KnowledgeIndexFile | null {
  try {
    const index = JSON.parse(raw) as KnowledgeIndexFile
    return Array.isArray(index?.spaces) ? index : null
  } catch {
    return null
  }
}

async function readJsonArrayQuietly<T>(path: string): Promise<T[]> {
  const raw = await readOptionalFile(path)
  if (raw === null) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as T[]) : []
  } catch {
    return []
  }
}

/**
 * What the package looks like without reading it: enough to tell a copy that nothing has changed. The search index is
 * left out: it is rewritten every few seconds while pages are read, and says nothing about the pages.
 */
async function packageSignature(packagePath: string): Promise<string> {
  const [root, pages] = await Promise.all([
    listPlatformFiles(packagePath),
    listPlatformFiles(joinPackagePath(packagePath, KNOWLEDGE_PAGES_DIR)),
  ])
  return [...root.entries, ...pages.entries]
    .filter(entry => !entry.isDirectory && entry.name !== KNOWLEDGE_SEARCH_INDEX_FILE)
    .map(entry => `${entry.name}:${entry.byteLength ?? ''}:${entry.modifiedAt ?? ''}`)
    .sort()
    .join('|')
}

/** How often a held copy looks for what another copy saved. The shell tells a copy held in a room nothing. */
const HELD_LOOK_MS = 15_000

/** Whether two reads of a package differ in anything but where each copy was looking. */
function sameKnowledge(a: KnowledgeStore, b: KnowledgeStore): boolean {
  if (a.pages.length !== b.pages.length) return false
  const byId = new Map(a.pages.map(page => [page.id, page]))
  return (
    b.pages.every(page => {
      const other = byId.get(page.id)
      return other === page || (other !== undefined && serializePageFile(other) === serializePageFile(page))
    }) &&
    JSON.stringify(a.spaces) === JSON.stringify(b.spaces) &&
    JSON.stringify(a.agentChanges ?? []) === JSON.stringify(b.agentChanges ?? []) &&
    a.activity.length === b.activity.length &&
    a.activity[0]?.id === b.activity[0]?.id
  )
}

/** A whole store handed in was made a moment ago: a page this copy has since taken a newer version of is not an edit. */
function withoutOlderPages(update: KnowledgeStore, local: KnowledgeStore): KnowledgeStore {
  const newest = new Map(local.pages.map(page => [page.id, page]))
  const stamp = (page: KnowledgePage) => Date.parse(page.updatedAt) || 0
  const pages = update.pages.map(page => {
    const known = newest.get(page.id)
    return known && stamp(page) < stamp(known) ? known : page
  })
  return pages.every((page, index) => page === update.pages[index]) ? update : { ...update, pages }
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
  const manifestRaw = await readOptionalFile(resolveKnowledgeManifestPath(packagePath))
  const manifest = manifestRaw ? JSON.parse(manifestRaw) : null
  if (index.organisationId || manifest?.organisationId) validateOrganisationLibrary(index, manifest, index.organisationId || manifest.organisationId)
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
  const pages = new Array<NonNullable<ReturnType<typeof parsePageFile>> | undefined>(
    entries.length,
  )
  let cursor = 0
  // Bound bridge traffic while overlapping independent page reads. Keep the
  // listing order deterministic, including duplicate-identity recovery.
  const readPages = async () => {
    while (cursor < entries.length) {
      const position = cursor++
      const entry = entries[position]!
      // Another copy can delete or rename a page between the listing and this read.
      const raw = await readOptionalFile(entry.path)
      if (raw === null) continue
      const page = parsePageFile(raw)
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
  return assembleKnowledgeStore(
    index,
    pages.filter((page): page is KnowledgePage => Boolean(page)),
    activity,
    proposals,
  )
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
      boot.organisation,
    )
    // Clearing a handled resource is not an instruction to reopen the boot
    // package. Imports likewise belong to the currently bound knowledge base.
    if (resourcePath && !target.importFilePath)
      boundPackageRef.current = target.packagePath
    return target
  }, [boot.appSettings.storePath, boot.prefs.workingDirectory, boot.organisation, resourcePath])
  const storePath = packagePath
  const heldCopy = boot.heldCopy === true
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
    signature: string | null
    /** What saves settled differently from what they were asked to save, for the saves queued behind them. */
    settled: Array<{ saved: KnowledgeStore; settled: KnowledgeStore }>
  } | null>(null)
  if (workspaceRef.current?.path !== packagePath) {
    workspaceRef.current = {
      path: packagePath,
      local: null,
      durable: null,
      pending: 0,
      revision: 0,
      reload: 0,
      signature: null,
      settled: [],
    }
  }
  const workspace = workspaceRef.current
  const handledRef = useRef(onResourceHandled)
  handledRef.current = onResourceHandled
  const saveChainRef = useRef<Promise<void>>(Promise.resolve())
  const saveStoreRef = useRef<((update: KnowledgeStoreUpdate) => Promise<void>) | null>(null)
  const saveFailedRef = useRef(saveFailed)
  saveFailedRef.current = saveFailed

  // Capture the import intent before the viewport resource is cleared. A held copy never imports: it is opened again
  // each time its page is, and the file would become a new page each time.
  useEffect(() => {
    if (importFilePath && !heldCopy) setPendingImport(importFilePath)
  }, [heldCopy, importFilePath])

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
        if (heldCopy) workspace.signature = await packageSignature(packagePath).catch(() => null)
        let nextStore: KnowledgeStore | null = await readKnowledgePagesLayout(
          packagePath,
        )
        if (!nextStore) {
          if(boot.organisation) throw Error('Create this organisation’s knowledge library from its Knowledge workspace first. No personal library was opened or imported.')
          nextStore = await withKnowledgeWriter(async () => {
            // Another copy may have made it while this one waited its turn.
            const made = await readKnowledgePagesLayout(packagePath)
            if (made) return made
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
            let fresh: KnowledgeStore
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
              fresh = parseKnowledgeStore(raw)
            } else fresh = createDefaultKnowledgeStore()
            if (cancelled) return null
            await writeKnowledgePages(packagePath, null, fresh)
            if (blob !== null) {
              await renamePlatformFile(
                storeFilePath,
                `${storeFilePath.split('/').pop()!}.pre-pages-backup`,
              ).catch(() => {})
            }
            return fresh
          })
        }
        if (cancelled || !nextStore) return
        if(boot.organisation && nextStore.organisationId!==boot.organisation.id) throw Error('This library is not bound to the host organisation.')
        // A held copy opened on one library must not make it the app's library, or move the person's place in it.
        if (!nextStore.organisationId && !heldCopy) await updateKnowledgeSettings({ storePath: packagePath })
        if (cancelled) return
        if (!importFilePath || heldCopy) handledRef.current?.()
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
  }, [boot.prefs.workingDirectory, heldCopy, packagePath, workspace])

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
      if (!saveFailedRef.current) setError(null)
      // A look that found nothing new changes nothing and says nothing.
      if (workspace.durable && sameKnowledge(workspace.durable, incoming)) return
      const before = workspace.durable
      const merged = workspace.local
        ? mergeExternalKnowledgeStore(
            workspace.local,
            incoming,
            workspace.durable,
          )
        : null
      // A page kept over the file stays different from the baseline, so the next save still meets the file's words.
      const keptOver = new Set(merged?.conflictIds ?? [])
      workspace.durable = keptOver.size && before
        ? {
            ...incoming,
            pages: incoming.pages.map(page =>
              keptOver.has(page.id)
                ? before.pages.find(known => known.id === page.id) ?? page
                : page,
            ),
          }
        : incoming
      workspace.local = merged?.store ?? incoming
      // Words typed on a page that has since been deleted elsewhere go back through a save, which keeps them.
      if (merged?.deletedWithWords.length && workspace.durable) {
        workspace.durable = {
          ...workspace.durable,
          pages: [...merged.deletedWithWords.flatMap(page => {
            const known = before?.pages.find(candidate => candidate.id === page.id)
            return known ? [known] : []
          }), ...workspace.durable.pages],
        }
        workspace.local = {
          ...workspace.local,
          pages: [...merged.deletedWithWords, ...workspace.local.pages],
        }
        void saveStoreRef.current?.(current => current).catch(() => undefined)
      }
      setStore(workspace.local)
      const said = merged ? describeExternalReload(merged) : null
      // Someone else's routine save is news in a tab, not in a small view inside a page.
      setExternalNotice(said ?? (merged && !heldCopy ? 'Reloaded changes made outside this window' : null))
    } catch (cause) {
      if (workspaceRef.current === workspace && request === workspace.reload)
        setError(cause instanceof Error ? cause : new Error(String(cause)))
    }
  }, [heldCopy, packagePath, workspace])

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
      if (change.path.endsWith(`/${KNOWLEDGE_SEARCH_INDEX_FILE}`)) return
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

  // A copy held in a room hears no change events: it looks, on an interval and when the person comes to it.
  useEffect(() => {
    if (loading || !heldCopy) return
    const look = async (): Promise<void> => {
      const signature = await packageSignature(packagePath).catch(() => null)
      if (signature === null || signature === workspace.signature) return
      workspace.signature = signature
      await reloadFromDisk()
    }
    const timer = window.setInterval(() => void look(), HELD_LOOK_MS)
    const onFocus = () => void look()
    const onVisible = () => {
      if (document.visibilityState === 'visible') void look()
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [heldCopy, loading, packagePath, reloadFromDisk, workspace])

  const saveStore = useCallback(
    async (update: KnowledgeStoreUpdate) => {
      if (workspaceRef.current !== workspace || !workspace.local)
        throw new Error('The knowledge workspace is not ready to save.')
      const nextStore =
        typeof update === 'function'
          ? update(workspace.local)
          : withoutOlderPages(update, workspace.local)
      if (nextStore.organisationId !== workspace.local.organisationId) throw new Error('A library cannot change its organisation binding.')
      workspace.local = nextStore
      ++workspace.revision
      ++workspace.pending
      setStore(nextStore)
      setSaving(true)
      setError(null)
      const run = saveChainRef.current.then(async () => {
        // This save was asked for before the ones ahead of it settled: it takes what they settled.
        const target = workspace.settled.reduce(
          (store, { saved, settled }) => foldSavedStore(store, saved, settled),
          nextStore,
        )
        // Merge against acknowledged disk state, never optimistic UI state.
        const saved = workspace.durable
          ? await saveKnowledgePackage(packagePath, workspace.durable, target, heldCopy)
          : await writeKnowledgePages(packagePath, null, target).then(() => ({ store: target, notices: [] as string[], arrivals: false }))
        workspace.durable = saved.store
        if (saved.store !== target) {
          workspace.settled.push({ saved: target, settled: saved.store })
          if (workspace.local) workspace.local = foldSavedStore(workspace.local, target, saved.store)
          if (workspaceRef.current === workspace) setStore(workspace.local)
        }
        if (workspaceRef.current === workspace) {
          if (saved.notices.length) setExternalNotice(saved.notices.join(' '))
          if (saved.arrivals) void reloadFromDisk()
        }
        if (workspaceRef.current === workspace && !target.organisationId && !heldCopy)
          await updateKnowledgeSettings({
            storePath: packagePath,
            activeSpaceId: target.activeSpaceId,
            activePageId: target.activePageId ?? undefined,
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
        if (!workspace.pending) workspace.settled = []
        if (workspaceRef.current === workspace) setSaving(workspace.pending > 0)
      }
    },
    [heldCopy, packagePath, reloadFromDisk, workspace],
  )
  saveStoreRef.current = saveStore

  // Import an opened .md/.txt file as a new page in the CURRENT store:
  // title from the file name, body from its content. storePath is not
  // touched — the file was input, never a knowledge base.
  useEffect(() => {
    if (!pendingImport || loading || !workspace.local) return
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
