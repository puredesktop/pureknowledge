import { toHtml } from '@purescience/platform-editor'
import {
  prepareCollectionDocumentHtml,
  relativizeCollectionAssetPath,
  type ReadCollectionBinary,
} from '@purescience/platform-ui/bridge/collectionDocumentHtml'

export interface KnowledgeImageLoadFailure {
  path: string
  message: string
}

export interface PreparedKnowledgeDocument {
  html: string
  imageFailures: KnowledgeImageLoadFailure[]
}

/**
 * Prepare page Markdown for display while retaining the asset failures that
 * the shared collection renderer deliberately tolerates.
 */
export async function prepareKnowledgeDocumentHtml(
  markdown: string,
  packagePath: string,
  readBinary: ReadCollectionBinary,
): Promise<PreparedKnowledgeDocument> {
  const failures = new Map<string, KnowledgeImageLoadFailure>()
  const reportingReader: ReadCollectionBinary = async absolutePath => {
    try {
      return await readBinary(absolutePath)
    } catch (error) {
      const path =
        relativizeCollectionAssetPath(absolutePath, packagePath) ?? absolutePath
      const message = error instanceof Error ? error.message : String(error)
      if (!failures.has(path)) {
        const failure = { path, message }
        failures.set(path, failure)
        console.warn(
          `[PureKnowledge] Could not load inline image "${path}": ${message}`,
        )
      }
      throw error
    }
  }

  const html = await prepareCollectionDocumentHtml(
    toHtml(markdown),
    packagePath,
    reportingReader,
  )
  return { html, imageFailures: [...failures.values()] }
}
