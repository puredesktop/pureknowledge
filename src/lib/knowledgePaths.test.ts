import { describe, expect, it } from 'vitest'
import {
  isKnowledgeImportFilePath,
  knowledgeImportTitleFromPath,
  knowledgeStoreFileNameForPackage,
  normalizeKnowledgePackagePath,
  resolveKnowledgeWorkspaceTarget,
  resolveDefaultKnowledgePackagePath,
  resolveDefaultKnowledgePath,
  resolveKnowledgeManifestPath,
  resolveKnowledgeStoreFilePath,
  resolveLegacyKnowledgePath,
  splitParentPath,
} from './knowledgePaths'

describe('knowledge paths', () => {
  it('stores knowledge as a package under the PureScience home folder from Documents', () => {
    expect(resolveDefaultKnowledgePackagePath('/Users/developer/Documents')).toBe(
      '/Users/developer/PureScience/knowledge.knowledge',
    )
    expect(resolveDefaultKnowledgePath('/Users/developer/Documents')).toBe(
      '/Users/developer/PureScience/knowledge.knowledge/knowledge.knowledge.json',
    )
  })

  it('reuses a PureScience working directory directly', () => {
    expect(resolveDefaultKnowledgePackagePath('/Users/developer/PureScience')).toBe(
      '/Users/developer/PureScience/knowledge.knowledge',
    )
    expect(resolveDefaultKnowledgePath('/Users/developer/PureScience')).toBe(
      '/Users/developer/PureScience/knowledge.knowledge/knowledge.knowledge.json',
    )
  })

  it('resolves package manifest and package-local store file paths', () => {
    const packagePath = '/Users/developer/PureScience/Team Wiki.knowledge'
    expect(knowledgeStoreFileNameForPackage(packagePath)).toBe(
      'Team Wiki.knowledge.json',
    )
    expect(resolveKnowledgeStoreFilePath(packagePath)).toBe(
      '/Users/developer/PureScience/Team Wiki.knowledge/Team Wiki.knowledge.json',
    )
    expect(resolveKnowledgeManifestPath(packagePath)).toBe(
      '/Users/developer/PureScience/Team Wiki.knowledge/manifest.json',
    )
  })

  it('normalizes legacy and resource paths to package paths', () => {
    expect(
      normalizeKnowledgePackagePath(
        '/Users/developer/PureScience/knowledge.json',
        '/Users/developer/Documents',
      ),
    ).toBe('/Users/developer/PureScience/knowledge.knowledge')
    expect(
      normalizeKnowledgePackagePath(
        '/Users/developer/PureScience/Team Wiki.knowledge',
        '/Users/developer/Documents',
      ),
    ).toBe('/Users/developer/PureScience/Team Wiki.knowledge')
    expect(
      normalizeKnowledgePackagePath(
        '/Users/developer/PureScience/Team Wiki.knowledge/Team Wiki.knowledge.json',
        '/Users/developer/Documents',
      ),
    ).toBe('/Users/developer/PureScience/Team Wiki.knowledge')
  })

  it('keeps the old single-file path available for migration', () => {
    expect(resolveLegacyKnowledgePath('/Users/developer/Documents')).toBe(
      '/Users/developer/PureScience/knowledge.json',
    )
  })

  it('splits parent paths', () => {
    expect(splitParentPath('/Users/developer/PureScience/knowledge.json')).toEqual({
      parent: '/Users/developer/PureScience',
      name: 'knowledge.json',
    })
  })
})

describe('markdown/text import seam (shell converts, app decides)', () => {
  it('recognizes importable md/markdown/txt files, case-insensitively', () => {
    expect(isKnowledgeImportFilePath('/tmp/notes.md')).toBe(true)
    expect(isKnowledgeImportFilePath('/tmp/notes.markdown')).toBe(true)
    expect(isKnowledgeImportFilePath('/tmp/Notes.TXT')).toBe(true)
    expect(isKnowledgeImportFilePath('/tmp/report.pdf')).toBe(false)
    expect(isKnowledgeImportFilePath('/tmp/Team Wiki.knowledge')).toBe(false)
    expect(isKnowledgeImportFilePath('')).toBe(false)
    expect(isKnowledgeImportFilePath(null)).toBe(false)
  })

  it('derives the imported page title from the file name', () => {
    expect(knowledgeImportTitleFromPath('/tmp/Meeting Notes.md')).toBe(
      'Meeting Notes',
    )
    expect(knowledgeImportTitleFromPath('/tmp/readme.txt')).toBe('readme')
  })

  it('imports an opened md file into the CURRENT store without rebinding', () => {
    const target = resolveKnowledgeWorkspaceTarget(
      '/Users/developer/Desktop/Meeting Notes.md',
      '/Users/developer/PureScience/Team Wiki.knowledge',
      '/Users/developer/Documents',
    )
    expect(target.packagePath).toBe(
      '/Users/developer/PureScience/Team Wiki.knowledge',
    )
    expect(target.importFilePath).toBe('/Users/developer/Desktop/Meeting Notes.md')
  })

  it('never mints an empty <file>.knowledge package from an md file', () => {
    const target = resolveKnowledgeWorkspaceTarget(
      '/Users/developer/Desktop/notes.md',
      undefined,
      '/Users/developer/Documents',
    )
    expect(target.packagePath).toBe(
      '/Users/developer/PureScience/knowledge.knowledge',
    )
    expect(target.packagePath).not.toContain('notes.md')
    expect(target.importFilePath).toBe('/Users/developer/Desktop/notes.md')
  })

  it('still rebinds when a .knowledge package is opened', () => {
    const target = resolveKnowledgeWorkspaceTarget(
      '/Users/developer/PureScience/Team Wiki.knowledge',
      '/Users/developer/PureScience/knowledge.knowledge',
      '/Users/developer/Documents',
    )
    expect(target.packagePath).toBe(
      '/Users/developer/PureScience/Team Wiki.knowledge',
    )
    expect(target.importFilePath).toBeNull()
  })
})
