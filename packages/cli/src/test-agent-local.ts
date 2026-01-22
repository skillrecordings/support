#!/usr/bin/env bun
/**
 * Local test script for support agent
 *
 * Usage:
 *   cd packages/cli && bun ../../scripts/test-agent-local.ts
 *
 * Tests that the agent can access appConfig through experimental_context,
 * specifically the instructor_teammate_id for assignToInstructor tool.
 */

import { runSupportAgent } from '@skillrecordings/core/agent'
import { database } from '@skillrecordings/database'
import { IntegrationClient } from '@skillrecordings/sdk/client'

async function main() {
  const appSlug = process.argv[2] || 'total-typescript'
  const testMessage =
    process.argv[3] ||
    'Hey Matt, just wanted to say your TypeScript course is amazing!'

  console.log('='.repeat(60))
  console.log('SUPPORT AGENT LOCAL TEST')
  console.log('='.repeat(60))
  console.log(`App: ${appSlug}`)
  console.log(`Message: ${testMessage}`)
  console.log('')

  // Fetch app from database
  const app = await database.query.AppsTable.findFirst({
    where: (apps, { eq }) => eq(apps.slug, appSlug),
  })

  if (!app) {
    console.error(`❌ App not found: ${appSlug}`)
    process.exit(1)
  }

  console.log('App Config:')
  console.log(
    `  instructor_teammate_id: ${app.instructor_teammate_id || '(not set)'}`
  )
  console.log(`  stripe_account_id: ${app.stripe_account_id || '(not set)'}`)
  console.log(`  integration_base_url: ${app.integration_base_url}`)
  console.log('')

  // Create integration client
  const integrationClient = new IntegrationClient({
    baseUrl: app.integration_base_url,
    webhookSecret: app.webhook_secret,
  })

  console.log('Running agent...')
  console.log('-'.repeat(60))

  try {
    const result = await runSupportAgent({
      message: testMessage,
      conversationHistory: [],
      customerContext: {
        email: '[EMAIL]',
      },
      appId: appSlug,
      model: 'anthropic/claude-haiku-4-5',
      integrationClient,
      appConfig: {
        instructor_teammate_id: app.instructor_teammate_id || undefined,
        stripeAccountId: app.stripe_account_id || undefined,
      },
    })

    console.log('')
    console.log('RESULT:')
    console.log('-'.repeat(60))
    console.log(`Response: ${result.response || '(no response)'}`)
    console.log(`Requires Approval: ${result.requiresApproval}`)
    console.log(`Auto-sent: ${result.autoSent || false}`)
    console.log('')
    console.log('Tool Calls:')
    for (const tc of result.toolCalls) {
      console.log(`  - ${tc.name}(${JSON.stringify(tc.args)})`)
      console.log(`    Result: ${JSON.stringify(tc.result)}`)
    }

    // Check if assignToInstructor was called and succeeded
    const assignCall = result.toolCalls.find(
      (tc) => tc.name === 'assignToInstructor'
    )
    if (assignCall) {
      const assignResult = assignCall.result as {
        assigned?: boolean
        error?: string
      }
      if (assignResult?.assigned) {
        console.log('')
        console.log(
          '✅ assignToInstructor SUCCEEDED - context was passed correctly!'
        )
      } else if (assignResult?.error) {
        console.log('')
        console.log(`❌ assignToInstructor FAILED: ${assignResult.error}`)
        console.log(
          '   This might indicate experimental_context is not being passed correctly.'
        )
      }
    }
  } catch (error) {
    console.error('❌ Agent error:', error)
    process.exit(1)
  }

  process.exit(0)
}

main()
