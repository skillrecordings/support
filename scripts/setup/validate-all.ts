#!/usr/bin/env bun
/**
 * Validate all configured services
 */

import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'

const ENV_FILE = resolve(process.cwd(), '.env.local')

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

interface ValidationResult {
  service: string
  status: 'success' | 'error' | 'skipped'
  message: string
  details?: unknown
}

async function validateFront(env: Record<string, string>): Promise<ValidationResult> {
  if (!env.FRONT_API_TOKEN) {
    return { service: 'Front', status: 'skipped', message: 'No API token configured' }
  }

  try {
    const res = await fetch('https://api2.frontapp.com/me', {
      headers: { Authorization: `Bearer ${env.FRONT_API_TOKEN}` }
    })

    if (res.ok) {
      const data = await res.json()
      return {
        service: 'Front',
        status: 'success',
        message: `Connected as ${data.email}`,
        details: data
      }
    } else {
      return { service: 'Front', status: 'error', message: `API error: ${res.status}` }
    }
  } catch (e) {
    return { service: 'Front', status: 'error', message: `Connection failed: ${e}` }
  }
}

async function validateSlack(env: Record<string, string>): Promise<ValidationResult> {
  if (!env.SLACK_BOT_TOKEN) {
    return { service: 'Slack', status: 'skipped', message: 'No bot token configured' }
  }

  try {
    const res = await fetch('https://slack.com/api/auth.test', {
      headers: { Authorization: `Bearer ${env.SLACK_BOT_TOKEN}` }
    })

    const data = await res.json()

    if (data.ok) {
      return {
        service: 'Slack',
        status: 'success',
        message: `Connected as ${data.bot_id} in ${data.team}`,
        details: data
      }
    } else {
      return { service: 'Slack', status: 'error', message: `API error: ${data.error}` }
    }
  } catch (e) {
    return { service: 'Slack', status: 'error', message: `Connection failed: ${e}` }
  }
}

async function validateStripe(env: Record<string, string>): Promise<ValidationResult> {
  if (!env.STRIPE_SECRET_KEY) {
    return { service: 'Stripe', status: 'skipped', message: 'No secret key configured' }
  }

  try {
    const res = await fetch('https://api.stripe.com/v1/balance', {
      headers: {
        Authorization: `Basic ${Buffer.from(env.STRIPE_SECRET_KEY + ':').toString('base64')}`
      }
    })

    if (res.ok) {
      const data = await res.json()
      const mode = env.STRIPE_SECRET_KEY.startsWith('sk_live') ? 'live' : 'test'
      return {
        service: 'Stripe',
        status: 'success',
        message: `Connected (${mode} mode)`,
        details: data
      }
    } else {
      return { service: 'Stripe', status: 'error', message: `API error: ${res.status}` }
    }
  } catch (e) {
    return { service: 'Stripe', status: 'error', message: `Connection failed: ${e}` }
  }
}

async function validateUpstash(env: Record<string, string>): Promise<ValidationResult> {
  if (!env.UPSTASH_VECTOR_URL || !env.UPSTASH_VECTOR_TOKEN) {
    return { service: 'Upstash Vector', status: 'skipped', message: 'Not configured' }
  }

  try {
    const res = await fetch(`${env.UPSTASH_VECTOR_URL}/info`, {
      headers: { Authorization: `Bearer ${env.UPSTASH_VECTOR_TOKEN}` }
    })

    if (res.ok) {
      const data = await res.json()
      return {
        service: 'Upstash Vector',
        status: 'success',
        message: `Connected (${data.result?.vectorCount || 0} vectors)`,
        details: data
      }
    } else {
      return { service: 'Upstash Vector', status: 'error', message: `API error: ${res.status}` }
    }
  } catch (e) {
    return { service: 'Upstash Vector', status: 'error', message: `Connection failed: ${e}` }
  }
}

async function validateCloudflare(env: Record<string, string>): Promise<ValidationResult> {
  if (!env.CLOUDFLARE_ACCOUNT_ID || !env.CLOUDFLARE_API_TOKEN) {
    return { service: 'Cloudflare', status: 'skipped', message: 'Not configured' }
  }

  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}`,
      { headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` } }
    )

    const data = await res.json()

    if (data.success) {
      return {
        service: 'Cloudflare',
        status: 'success',
        message: `Connected to account ${data.result?.name || env.CLOUDFLARE_ACCOUNT_ID}`,
        details: data
      }
    } else {
      return { service: 'Cloudflare', status: 'error', message: `API error: ${data.errors?.[0]?.message}` }
    }
  } catch (e) {
    return { service: 'Cloudflare', status: 'error', message: `Connection failed: ${e}` }
  }
}

async function validateAxiom(env: Record<string, string>): Promise<ValidationResult> {
  if (!env.AXIOM_TOKEN || !env.AXIOM_DATASET) {
    return { service: 'Axiom', status: 'skipped', message: 'Not configured' }
  }

  try {
    const res = await fetch('https://api.axiom.co/v1/datasets', {
      headers: { Authorization: `Bearer ${env.AXIOM_TOKEN}` }
    })

    if (res.ok) {
      const data = await res.json()
      const hasDataset = data.some((d: { name: string }) => d.name === env.AXIOM_DATASET)
      return {
        service: 'Axiom',
        status: 'success',
        message: hasDataset ? `Connected (dataset: ${env.AXIOM_DATASET})` : `Connected (dataset ${env.AXIOM_DATASET} not found)`,
        details: data
      }
    } else {
      return { service: 'Axiom', status: 'error', message: `API error: ${res.status}` }
    }
  } catch (e) {
    return { service: 'Axiom', status: 'error', message: `Connection failed: ${e}` }
  }
}

// Main
async function main() {
  console.log('\n🔍 Validating Services\n')
  console.log('─'.repeat(60))

  const env = parseEnvFile(ENV_FILE)

  const validators = [
    validateFront,
    validateSlack,
    validateStripe,
    validateUpstash,
    validateCloudflare,
    validateAxiom,
  ]

  const results = await Promise.all(validators.map(v => v(env)))

  for (const result of results) {
    const icon = result.status === 'success' ? '✅' : result.status === 'error' ? '❌' : '⬜'
    console.log(`${icon} ${result.service.padEnd(20)} ${result.message}`)
  }

  console.log('─'.repeat(60))

  const successCount = results.filter(r => r.status === 'success').length
  const errorCount = results.filter(r => r.status === 'error').length

  console.log(`\n${successCount} passed, ${errorCount} failed, ${results.length - successCount - errorCount} skipped\n`)

  if (errorCount > 0) {
    process.exit(1)
  }
}

main()
