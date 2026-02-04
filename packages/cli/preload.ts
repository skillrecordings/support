import path from 'node:path'
import { loadSecrets } from './src/lib/env-loader.js'

// Calculate CLI package root - works for both dev (preload.ts) and bundled (dist/preload.js)
// In dev: dirname is packages/cli, so '..' goes to packages, '../..' to root - wrong, we want '.'
// In bundle: dirname is packages/cli/dist, so '..' goes to packages/cli - correct
// Solution: check if we're in dist/ and adjust accordingly
const dirname = import.meta.dirname
const cliDir =
  dirname.endsWith('/dist') || dirname.endsWith('\\dist')
    ? path.resolve(dirname, '..')
    : dirname

// Don't crash for commands that don't need secrets (--help, auth, etc.)
const noSecretsNeeded =
  process.argv.length <= 2 ||
  process.argv.some((a) =>
    ['--help', '-h', '--version', '-V', 'auth'].includes(a)
  )

try {
  await loadSecrets(cliDir)
} catch (err) {
  if (noSecretsNeeded) {
    // Skip env validation so index.js can load without DATABASE_URL
    process.env.SKIP_ENV_VALIDATION = '1'
  } else {
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  }
}
