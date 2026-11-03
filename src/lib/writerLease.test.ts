import { describe, expect, it } from 'vitest'
import { LeaseBusyError, createWriterLease, type LeasePort } from './writerLease'

/** The shell's JSON store: writes one at a time, conditional on the version read. */
function store() {
  const file: { value: unknown; version: string | null } = { value: null, version: null }
  let writes = 0
  const port: LeasePort = {
    read: async () => {
      await new Promise(resolve => setTimeout(resolve, 0))
      return { value: file.value, version: file.version }
    },
    write: async (value, ifMatch) => {
      await new Promise(resolve => setTimeout(resolve, 0))
      if (ifMatch !== file.version) return { ok: false, version: file.version }
      file.value = value
      file.version = `v${++writes}`
      return { ok: true, version: file.version }
    },
  }
  return { file, port }
}
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

describe('createWriterLease', () => {
  it('lets one writer in at a time, however many ask together', async () => {
    const { port } = store()
    const withWriter = createWriterLease(port, { sleep: () => sleep(1) })
    let inside = 0
    let most = 0
    await Promise.all(Array.from({ length: 6 }, () => withWriter(async () => {
      inside += 1
      most = Math.max(most, inside)
      await sleep(3)
      inside -= 1
    })))
    expect(most).toBe(1)
  })

  it('hands the lease back, also when the work throws', async () => {
    const { file, port } = store()
    const withWriter = createWriterLease(port, { sleep: () => sleep(1) })
    await expect(withWriter(async () => { throw new Error('no') })).rejects.toThrow('no')
    expect(file.value).toBeNull()
    await expect(withWriter(async () => 'done')).resolves.toBe('done')
  })

  it('does not wait forever for a copy that went away: the lease runs out', async () => {
    const { file, port } = store()
    file.value = { token: 'gone', until: Date.now() + 15 }
    file.version = 'held'
    const withWriter = createWriterLease(port, { ttlMs: 20, waitMs: 500, sleep: () => sleep(1) })
    await expect(withWriter(async () => 'done')).resolves.toBe('done')
  })

  it('says so when it cannot get a turn, and does not run the work', async () => {
    const { file, port } = store()
    file.value = { token: 'busy', until: Date.now() + 60_000 }
    file.version = 'held'
    const withWriter = createWriterLease(port, { waitMs: 10, sleep: () => sleep(1) })
    let ran = false
    await expect(withWriter(async () => { ran = true })).rejects.toBeInstanceOf(LeaseBusyError)
    expect(ran).toBe(false)
  })

  it('a store that cannot be reached does not stop the save', async () => {
    const withWriter = createWriterLease({
      read: async () => { throw new Error('no store') },
      write: async () => { throw new Error('no store') },
    })
    await expect(withWriter(async () => 'done')).resolves.toBe('done')
  })
})
