import { loadSecrets } from './src/lib/env-loader.js'

// Load env from the CLI package directory before anything else
// Don't crash for commands that don't need secrets (--help, auth, etc.)
const noSecretsNeeded = process.argv.some((a) =>
  ['--help', '-h', '--version', '-V', 'auth'].includes(a)
)

try {
  await loadSecrets()
} catch (err) {
  if (noSecretsNeeded) {
    // Silently continue - these commands don't need secrets
  } else {
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  }
}
