#!/usr/bin/env bun
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const cliDir = join(__dirname, '..')

// Commands that don't need database/secrets
const noSecretsNeeded = process.argv.some((a) =>
	['--help', '-h', '--version', '-V', 'auth'].includes(a)
)

// Skip env validation for commands that don't need it
if (noSecretsNeeded) {
	process.env.SKIP_ENV_VALIDATION = '1'
}

// Load env from CLI package directory
try {
	const dotenvFlow = await import('dotenv-flow')
	dotenvFlow.config({ path: cliDir, silent: true })
} catch {
	// Ignore - env loading is optional
}

// Now import the main CLI
await import('../dist/index.js')
