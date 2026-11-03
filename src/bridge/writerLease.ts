import { readPlatformStorageJson, writePlatformStorageJson } from '@purescience/platform-ui/bridge/storage'
import { KNOWLEDGE_APP_SLUG } from '../constants'
import { createWriterLease } from '../lib/writerLease'

const request = { appSlug: KNOWLEDGE_APP_SLUG, fileName: 'knowledge-writer.json' as const }

/** Run a save while no other live copy of PureKnowledge on this desk is saving. */
export const withKnowledgeWriter = createWriterLease({
  read: async () => {
    const { value, version } = await readPlatformStorageJson(request)
    return { value, version }
  },
  write: async (value, ifMatch) => {
    const { ok, version } = await writePlatformStorageJson({ ...request, value, ifMatch })
    return { ok, version }
  },
})
