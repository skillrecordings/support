#!/usr/bin/env bun
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const cliDir = join(__dirname, '..')

// Skip env validation at import time - let commands fail at runtime if they need missing vars
// This allows help, auth, and other non-db commands to work without DATABASE_URL
process.env.SKIP_ENV_VALIDATION = '1'

// Load env from CLI package directory
try {
	const dotenvFlow = await import('dotenv-flow')
	dotenvFlow.config({ path: cliDir, silent: true })
} catch {
	// Ignore - env loading is optional
}

// Now import the main CLI
await import('../dist/index.js')
