import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const deliveryCommands = [
  ['npm', 'run', 'typecheck'],
  ['npm', 'run', 'test'],
  ['npm', 'run', 'build'],
  ['git', 'diff', '--check'],
]

/** Fail closed: untracked acceptance tests are not evidence about HEAD. */
export function requireCommittedHead(run, expectedHead) {
  const head = run(['git', 'rev-parse', 'HEAD']).stdout.trim()
  if (!/^[a-f0-9]{40}$/.test(head))
    throw new Error('Cannot identify the full commit SHA.')
  if (expectedHead && expectedHead !== head)
    throw new Error('HEAD changed during verification.')
  if (
    run(['git', 'status', '--porcelain', '--untracked-files=all']).stdout.trim()
  ) {
    throw new Error(
      'Commit all delivery source and tests through PureDev before verifying HEAD. The worktree has uncommitted or untracked files.',
    )
  }
  return head
}

export function verifyDelivery({ cwd = process.cwd(), suite } = {}) {
  const run = (args, directory = cwd, options = {}) => {
    const result = spawnSync(args[0], args.slice(1), {
      cwd: directory,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      ...options,
    })
    if (result.error || result.status !== 0) {
      throw new Error(
        `${args.join(' ')} failed (${result.status}): ${
          result.error?.message ?? result.stderr ?? ''
        }`,
      )
    }
    return result
  }
  const head = requireCommittedHead(run)
  const tree = run(['git', 'rev-parse', 'HEAD^{tree}']).stdout.trim()
  const directory = mkdtempSync(join(tmpdir(), 'pureknowledge-delivery-'))
  let checkDirectory = cwd
  if (suite) {
    // Verify an archive of the immutable commit, not a hand-copied worktree.
    suite = resolve(suite)
    checkDirectory = join(directory, 'suite', 'apps', 'pureknowledge')
    mkdirSync(checkDirectory, { recursive: true })
    const archive = run(['git', 'archive', head], cwd, {
      encoding: null,
    }).stdout
    run(['tar', '-xf', '-', '-C', checkDirectory], cwd, { input: archive })
    const layout = join(directory, 'suite')
    for (const name of [
      'packages',
      'scripts',
      'node_modules',
      'tsconfig.base.json',
    ]) {
      symlinkSync(join(suite, name), join(layout, name))
    }
    // Keep Vite's generated cache writable without touching suite dependencies.
    const dependencies = join(checkDirectory, 'node_modules')
    mkdirSync(join(dependencies, '.bin'), { recursive: true })
    symlinkSync(
      join(suite, 'apps/pureknowledge/node_modules/vite'),
      join(dependencies, 'vite'),
    )
    symlinkSync(
      join(suite, 'apps/pureknowledge/node_modules/@vitejs'),
      join(dependencies, '@vitejs'),
    )
    symlinkSync(
      join(suite, 'apps/pureknowledge/node_modules/vite/bin/vite.js'),
      join(dependencies, '.bin/vite'),
    )
  }
  const recordPath = join(directory, 'delivery.json')
  const record = {
    head,
    tree,
    suite: suite ?? null,
    checkDirectory,
    verified: false,
    commands: [],
  }
  try {
    for (const [index, command] of deliveryCommands.entries()) {
      requireCommittedHead(run, head)
      const commandDirectory = command[0] === 'git' ? cwd : checkDirectory
      const result = spawnSync(command[0], command.slice(1), {
        cwd: commandDirectory,
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
      })
      const log = join(directory, `${index + 1}-${command[0]}.log`)
      writeFileSync(
        log,
        `${result.stdout ?? ''}\n${result.stderr ?? ''}${
          result.error?.message ?? ''
        }`,
      )
      record.commands.push({
        command,
        cwd: commandDirectory,
        exitCode: result.status,
        log,
      })
      if (result.error || result.status !== 0)
        throw new Error(`${command.join(' ')} failed; see ${log}`)
      requireCommittedHead(run, head)
    }
    record.verified = true
  } catch (error) {
    record.error = error.message
    throw error
  } finally {
    writeFileSync(recordPath, JSON.stringify(record, null, 2) + '\n')
    process.stdout.write(`Delivery record: ${recordPath}\n`)
  }
  return record
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const args = process.argv.slice(2)
    if (args.length && (args.length !== 2 || args[0] !== '--suite'))
      throw new Error(
        'Usage: npm run verify:delivery -- [--suite /path/to/compatible-suite]',
      )
    verifyDelivery({ suite: args[1] })
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  }
}
