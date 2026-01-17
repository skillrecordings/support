#!/usr/bin/env bun
/**
 * Check setup status - which services are configured
 */

import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'

const ENV_FILE = resolve(process.cwd(), '.env.local')

interface ServiceConfig {
  name: string
  required: string[]
  optional?: string[]
}

const SERVICES: ServiceConfig[] = [
  {
    name: 'PlanetScale',
    required: ['DATABASE_URL'],
  },
  {
    name: 'Front',
    required: ['FRONT_API_TOKEN', 'FRONT_WEBHOOK_SECRET'],
    optional: ['FRONT_INBOX_TOTAL_TYPESCRIPT', 'FRONT_INBOX_PRO_TAILWIND'],
  },
  {
    name: 'Slack',
    required: ['SLACK_BOT_TOKEN', 'SLACK_SIGNING_SECRET', 'SLACK_APPROVAL_CHANNEL_ID'],
  },
  {
    name: 'Stripe',
    required: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'],
    optional: ['STRIPE_ACCOUNT_TOTAL_TYPESCRIPT', 'STRIPE_ACCOUNT_PRO_TAILWIND'],
  },
  {
    name: 'Upstash Vector',
    required: ['UPSTASH_VECTOR_URL', 'UPSTASH_VECTOR_TOKEN'],
  },
  {
    name: 'Cloudflare',
    required: ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN'],
  },
  {
    name: 'Axiom',
    required: ['AXIOM_DATASET', 'AXIOM_TOKEN'],
  },
  {
    name: 'Langfuse',
    required: ['LANGFUSE_PUBLIC_KEY', 'LANGFUSE_SECRET_KEY'],
    optional: ['LANGFUSE_HOST'],
  },
  {
    name: 'BetterAuth',
    required: ['BETTERAUTH_SECRET'],
    optional: ['BETTERAUTH_URL'],
  },
]

function parseEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {}

  const content = readFileSync(path, 'utf-8')
  const env: Record<string, string> = {}

  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const [key, ...valueParts] = trimmed.split('=')
    const value = valueParts.join('=').trim()
    if (key && value) {
      env[key.trim()] = value
    }
  }

  return env
}

function checkService(service: ServiceConfig, env: Record<string, string>) {
  const missing = service.required.filter(key => !env[key])
  const configured = service.required.filter(key => env[key])
  const optionalConfigured = (service.optional || []).filter(key => env[key])

  return {
    name: service.name,
    status: missing.length === 0 ? 'ready' : configured.length > 0 ? 'partial' : 'not started',
    configured,
    missing,
    optionalConfigured,
  }
}

// Main
const env = parseEnvFile(ENV_FILE)
const results = SERVICES.map(s => checkService(s, env))

console.log('\n📊 Setup Status\n')
console.log('─'.repeat(60))

let readyCount = 0
let partialCount = 0
let notStartedCount = 0

for (const result of results) {
  const icon = result.status === 'ready' ? '✅' : result.status === 'partial' ? '🔶' : '⬜'
  const statusText = result.status === 'ready' ? 'Ready' : result.status === 'partial' ? 'Partial' : 'Not started'

  console.log(`${icon} ${result.name.padEnd(20)} ${statusText}`)

  if (result.missing.length > 0) {
    console.log(`   Missing: ${result.missing.join(', ')}`)
  }

  if (result.status === 'ready') readyCount++
  else if (result.status === 'partial') partialCount++
  else notStartedCount++
}

console.log('─'.repeat(60))
console.log(`\n${readyCount}/${SERVICES.length} services ready`)

if (notStartedCount > 0 || partialCount > 0) {
  console.log('\n📝 Next steps:')
  const nextService = results.find(r => r.status !== 'ready')
  if (nextService) {
    console.log(`   Configure ${nextService.name}: missing ${nextService.missing.join(', ')}`)
  }
}

console.log('')
