import { describe, expect, it } from 'vitest'
import { requireCommittedHead } from './verify-delivery.mjs'

const head = 'a'.repeat(40)
const runner =
  (status = '', sha = head) =>
  (args: string[]) => ({
    stdout: args[1] === 'rev-parse' ? sha + '\n' : status,
  })

describe('committed-head delivery preflight', () => {
  it('accepts a clean worktree and records its full SHA', () => {
    expect(requireCommittedHead(runner())).toBe(head)
  })
  it.each([' M src/App.tsx', '?? src/acceptance.test.ts', 'A  src/new.ts'])(
    'rejects uncommitted source or tests: %s',
    (status) => {
      expect(() => requireCommittedHead(runner(status))).toThrow(
        'uncommitted or untracked',
      )
    },
  )
  it('rejects a changed or missing commit identity', () => {
    expect(() =>
      requireCommittedHead(runner('', 'b'.repeat(40)), head),
    ).toThrow('HEAD changed')
    expect(() => requireCommittedHead(runner('', ''))).toThrow(
      'full commit SHA',
    )
  })
})

// Exercise record generation without creating a commit or running nested npm
// processes. The real CLI's dirty-tree refusal is checked separately.
import { spawnSync } from 'node:child_process'
import { readFileSync, rmSync } from 'node:fs'
import { dirname } from 'node:path'
import { afterEach, vi } from 'vitest'
import { verifyDelivery, deliveryCommands } from './verify-delivery.mjs'

vi.mock('node:child_process', () => ({ spawnSync: vi.fn() }))
const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true })
  vi.restoreAllMocks()
  vi.mocked(spawnSync).mockReset()
})

function mockCommands({ failBuild = false, changeHead = false } = {}) {
  let afterCheck = false
  vi.mocked(spawnSync).mockImplementation((command, args) => {
    const list = args as string[]
    let stdout: string | Buffer = ''
    let status = 0
    if (command === 'git' && list[0] === 'rev-parse') {
      stdout =
        list[1] === 'HEAD^{tree}'
          ? 'c'.repeat(40)
          : changeHead && afterCheck
          ? 'b'.repeat(40)
          : head
    }
    if (command === 'git' && list[0] === 'archive')
      stdout = Buffer.from('immutable archive fixture')
    if (command === 'npm') {
      afterCheck = true
      stdout = 'Fixture check output'
      if (failBuild && list[1] === 'build') status = 1
    }
    return {
      status,
      stdout,
      stderr: '',
      pid: 1,
      signal: null,
      output: [null, stdout, ''],
    } as ReturnType<typeof spawnSync>
  })
  return vi.spyOn(process.stdout, 'write').mockImplementation((text) => {
    const match = String(text).match(/Delivery record: (.+)\n/)
    if (match) directories.push(dirname(match[1]!))
    return true
  })
}

it('records the immutable full head, exact commands, successful results and logs', () => {
  mockCommands()
  const record = verifyDelivery({ suite: '/fixture/compatible-suite' })
  expect(record).toMatchObject({ head, tree: 'c'.repeat(40), verified: true })
  expect(
    record.commands.map((entry: { command: string[] }) => entry.command),
  ).toEqual(deliveryCommands)
  for (const entry of record.commands) {
    expect(entry.exitCode).toBe(0)
    expect(readFileSync(entry.log, 'utf8')).toBeDefined()
  }
  expect(spawnSync).toHaveBeenCalledWith(
    'git',
    ['archive', head],
    expect.anything(),
  )
  const saved = JSON.parse(
    readFileSync(directories[0]! + '/delivery.json', 'utf8'),
  )
  expect(saved).toEqual(record)
})

it.each([{ failBuild: true }, { changeHead: true }])(
  'never marks a failed or changed head as verified: %j',
  (options) => {
    mockCommands(options)
    expect(() => verifyDelivery()).toThrow()
    const saved = JSON.parse(
      readFileSync(directories[0]! + '/delivery.json', 'utf8'),
    )
    expect(saved.verified).toBe(false)
    expect(saved.error).toBeTruthy()
  },
)
