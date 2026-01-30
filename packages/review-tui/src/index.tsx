#!/usr/bin/env bun
/**
 * FAQ Review TUI
 *
 * Terminal UI for reviewing FAQ candidates mined from support conversations.
 *
 * Usage:
 *   bun run src/index.tsx
 *
 * Requires environment variables:
 *   UPSTASH_REDIS_REST_URL
 *   UPSTASH_REDIS_REST_TOKEN
 */

import { render } from '@opentui/solid'
import { App } from './components/App'

// Check for required env vars
function checkEnv() {
  const required = ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']
  const missing = required.filter((key) => !process.env[key])

  if (missing.length > 0) {
    console.error('Missing required environment variables:')
    missing.forEach((key) => console.error(`  - ${key}`))
    console.error('\nSet these in .env.local or export them before running.')
    process.exit(1)
  }
}

async function main() {
  checkEnv()

  try {
    await render(() => <App />)
  } catch (error) {
    console.error('Failed to start TUI:', error)
    process.exit(1)
  }
}

main()
