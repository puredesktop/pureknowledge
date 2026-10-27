import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Shared UI assets resolve through the SDK's real checkout in isolated
  // app worktrees. Permit that workspace as well as this app for raw SVGs.
  server: {
    fs: {
      allow: [
        '.',
        resolve(
          dirname(
            fileURLToPath(import.meta.resolve('@purescience/platform-ui')),
          ),
          '../../..',
        ),
      ],
    },
  },
  test: {
    environment: 'node',
    globals: true,
  },
})
