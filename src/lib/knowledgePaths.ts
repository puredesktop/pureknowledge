import {
  KNOWLEDGE_PACKAGE_MANIFEST_FILE_NAME,
  KNOWLEDGE_PACKAGE_SUFFIX,
  LEGACY_KNOWLEDGE_STORE_FILE_NAME,
} from '../constants'

function trimTrailingSlash(path: string): string {
  return path.replace(/\/+$/, '')
}

function resolvePureScienceDirectory(workingDirectory: string): string {
  const clean = trimTrailingSlash(workingDirectory || '')
  if (!clean) return '~/PureScience'
  if (clean.endsWith('/PureScience')) {
    return clean
  }
  if (clean.endsWith('/Documents')) {
    return `${clean.replace(/\/Documents$/, '')}/PureScience`
  }
  return `${clean}/PureScience`
}

export function resolveDefaultKnowledgePackagePath(
  workingDirectory: string,
): string {
  return `${resolvePureScienceDirectory(
    workingDirectory,
  )}/knowledge${KNOWLEDGE_PACKAGE_SUFFIX}`
}

export function resolveLegacyKnowledgePath(workingDirectory: string): string {
  return `${resolvePureScienceDirectory(
    workingDirectory,
  )}/${LEGACY_KNOWLEDGE_STORE_FILE_NAME}`
}

export function resolveDefaultKnowledgePath(workingDirectory: string): string {
  return resolveKnowledgeStoreFilePath(
    resolveDefaultKnowledgePackagePath(workingDirectory),
  )
}

export function splitParentPath(path: string): {
  parent: string
  name: string
} {
  const parts = trimTrailingSlash(path).split('/')
  const name = parts.pop() ?? ''
  return {
    parent: parts.join('/') || '/',
    name,
  }
}

export function isKnowledgePackagePath(path: string): boolean {
  return trimTrailingSlash(path)
    .toLowerCase()
    .endsWith(KNOWLEDGE_PACKAGE_SUFFIX)
}

export function knowledgePackageBaseName(packagePath: string): string {
  const { name } = splitParentPath(packagePath)
  if (name.toLowerCase().endsWith(KNOWLEDGE_PACKAGE_SUFFIX)) {
    return name.slice(0, -KNOWLEDGE_PACKAGE_SUFFIX.length) || 'knowledge'
  }
  return name || 'knowledge'
}

export function knowledgeStoreFileNameForPackage(packagePath: string): string {
  return `${knowledgePackageBaseName(
    packagePath,
  )}${KNOWLEDGE_PACKAGE_SUFFIX}.json`
}

export function resolveKnowledgeStoreFilePath(packagePath: string): string {
  const clean = trimTrailingSlash(packagePath)
  return `${clean}/${knowledgeStoreFileNameForPackage(clean)}`
}

export function resolveKnowledgeManifestPath(packagePath: string): string {
  return `${trimTrailingSlash(
    packagePath,
  )}/${KNOWLEDGE_PACKAGE_MANIFEST_FILE_NAME}`
}

const IMPORTABLE_EXTENSIONS = ['md', 'markdown', 'txt'] as const

/**
 * A plain markdown/text file opened from the shell is IMPORT input, never
 * a knowledge store: the house seam is "shell converts, app decides" —
 * the app imports the content as a page into the CURRENT store and the
 * bound storePath does not change. Feeding such a path through
 * normalizeKnowledgePackagePath instead would mint an empty
 * `<file>.knowledge` package and silently unbind the real knowledge base.
 */
export function isKnowledgeImportFilePath(
  path: string | null | undefined,
): boolean {
  const trimmed = trimTrailingSlash(path?.trim() ?? '')
  if (!trimmed) return false
  if (isKnowledgePackagePath(trimmed)) return false
  const extension = trimmed.split('.').pop()?.toLowerCase() ?? ''
  return (IMPORTABLE_EXTENSIONS as readonly string[]).includes(extension)
}

/** Page title for an imported file: file name without its extension. */
export function knowledgeImportTitleFromPath(path: string): string {
  const { name } = splitParentPath(path)
  const title = name.replace(/\.[^.]+$/, '').trim()
  return title || name || 'Imported page'
}

export interface KnowledgeWorkspaceTarget {
  /** The package the workspace binds to (always the current/default store for imports). */
  packagePath: string
  /** A markdown/text file to import into that store, or null. */
  importFilePath: string | null
}

/**
 * Decide what an incoming shell resource means for the workspace:
 * a .knowledge package (or folder) rebinds the store; a .md/.txt file
 * is imported into the store named by settings, which stays bound.
 */
export function resolveKnowledgeWorkspaceTarget(
  resourcePath: string | null | undefined,
  settingsStorePath: string | null | undefined,
  workingDirectory: string,
): KnowledgeWorkspaceTarget {
  if (resourcePath && isKnowledgeImportFilePath(resourcePath)) {
    return {
      packagePath: normalizeKnowledgePackagePath(
        settingsStorePath,
        workingDirectory,
      ),
      importFilePath: resourcePath.trim(),
    }
  }
  return {
    packagePath: normalizeKnowledgePackagePath(
      resourcePath || settingsStorePath,
      workingDirectory,
    ),
    importFilePath: null,
  }
}

export function normalizeKnowledgePackagePath(
  path: string | null | undefined,
  workingDirectory: string,
): string {
  const trimmed = trimTrailingSlash(path?.trim() ?? '')
  if (!trimmed) return resolveDefaultKnowledgePackagePath(workingDirectory)
  if (isKnowledgePackagePath(trimmed)) return trimmed

  const { parent, name } = splitParentPath(trimmed)
  if (name.toLowerCase().endsWith(`${KNOWLEDGE_PACKAGE_SUFFIX}.json`)) {
    return isKnowledgePackagePath(parent)
      ? parent
      : resolveDefaultKnowledgePackagePath(workingDirectory)
  }

  if (name === LEGACY_KNOWLEDGE_STORE_FILE_NAME || name.endsWith('.json')) {
    return resolveDefaultKnowledgePackagePath(workingDirectory)
  }

  return `${trimmed}${KNOWLEDGE_PACKAGE_SUFFIX}`
}
