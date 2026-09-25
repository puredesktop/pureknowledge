import { KNOWLEDGE_APP_SLUG } from '../constants'
import type { KnowledgeStore } from './knowledgeTypes'
import { knowledgePackageBaseName } from './knowledgePaths'
import { KNOWLEDGE_INDEX_FILE, KNOWLEDGE_PAGES_DIR } from './knowledgePages'

export interface KnowledgePackageManifest {
  schemaVersion: 1
  appId: 'pureknowledge'
  slug: typeof KNOWLEDGE_APP_SLUG
  kind: 'knowledge'
  name: string
  /** Entry point of the page-per-file layout (spaces + active ids). */
  indexFile: typeof KNOWLEDGE_INDEX_FILE
  /** Directory of one-markdown-file-per-page content. */
  pagesDir: typeof KNOWLEDGE_PAGES_DIR
  createdAt: string
  updatedAt: string
}

export function createKnowledgePackageManifest(
  packagePath: string,
  store: KnowledgeStore,
): KnowledgePackageManifest {
  const baseName = knowledgePackageBaseName(packagePath)
  const primarySpace =
    store.spaces.find(space => space.id === store.activeSpaceId) ??
    store.spaces[0]
  const createdAt =
    primarySpace?.createdAt ??
    store.pages.map(page => page.createdAt).sort()[0] ??
    new Date().toISOString()
  const updatedAt =
    store.spaces
      .map(space => space.updatedAt)
      .concat(store.pages.map(page => page.updatedAt))
      .sort()
      .at(-1) ?? createdAt

  return {
    schemaVersion: 1,
    appId: 'pureknowledge',
    slug: KNOWLEDGE_APP_SLUG,
    kind: 'knowledge',
    name: primarySpace?.name ?? baseName,
    indexFile: KNOWLEDGE_INDEX_FILE,
    pagesDir: KNOWLEDGE_PAGES_DIR,
    createdAt,
    updatedAt,
  }
}

export function serializeKnowledgePackageManifest(
  manifest: KnowledgePackageManifest,
): string {
  return `${JSON.stringify(manifest, null, 2)}\n`
}
