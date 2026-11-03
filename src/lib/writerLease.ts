/**
 * One writer at a time across live copies of the app. A save reads files, merges and writes them; two copies doing that
 * at the same moment would each merge without the other's change. The shell has no conditional write for a file in a
 * folder, but its JSON store has one (`ifMatch`, atomic in the main process), so a small lease file in that store decides
 * who goes next. A copy that goes away mid-save only delays the others until its lease runs out.
 */
export interface LeasePort {
  read(): Promise<{ value: unknown; version: string | null }>
  write(value: unknown, ifMatch: string | null): Promise<{ ok: boolean; version: string | null }>
}

export interface LeaseOptions {
  /** How long a lease lasts if its holder never hands it back. */
  ttlMs?: number
  /** How long to wait for it before saying so. Longer than ttlMs, so a lost holder can never block a save. */
  waitMs?: number
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

export class LeaseBusyError extends Error {
  constructor() {
    super('Another window is still saving. Nothing was written; try again.')
    this.name = 'LeaseBusyError'
  }
}

interface LeaseValue { token: string; until: number }
const isHeld = (value: unknown, now: number): boolean => {
  const lease = value as Partial<LeaseValue> | null
  return typeof lease?.token === 'string' && typeof lease.until === 'number' && lease.until > now
}

export function createWriterLease(port: LeasePort, options: LeaseOptions = {}) {
  const ttlMs = options.ttlMs ?? 15_000
  const waitMs = options.waitMs ?? ttlMs + 5_000
  const now = options.now ?? Date.now
  const sleep = options.sleep ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)))

  /** The version to hand back, or null when the store cannot be reached and the save goes ahead on its merge alone. */
  async function acquire(): Promise<string | null> {
    const deadline = now() + waitMs
    const token = crypto.randomUUID()
    while (now() < deadline) {
      let free = false
      try {
        const { value, version } = await port.read()
        free = !isHeld(value, now())
        if (free) {
          const written = await port.write({ token, until: now() + ttlMs } satisfies LeaseValue, version)
          if (written.ok) return written.version
        }
      } catch {
        return null
      }
      await sleep(10 + Math.random() * 40)
    }
    throw new LeaseBusyError()
  }

  return async function withWriter<T>(work: () => Promise<T>): Promise<T> {
    const version = await acquire()
    try {
      return await work()
    } finally {
      if (version !== null) await port.write(null, version).catch(() => undefined)
    }
  }
}
