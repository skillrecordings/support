/**
 * Agent Alignment Eval - runs current agent against prod inputs
 * Compares local behavior to recorded prod behavior to detect drift
 */

import { readFileSync } from 'fs'
import { join } from 'path'
import { database } from '@skillrecordings/database'
import { IntegrationClient } from '@skillrecordings/sdk/client'
import { evalite } from 'evalite'
import { runSupportAgent } from '../agent/config'

interface DatasetSample {
  id: string
  app: string
  conversationId: string
  customerEmail: string
  triggerMessage: { subject: string; body: string; timestamp: number }
  agentResponse: { text: string; category: string; timestamp: string }
}

const datasetPath = join(__dirname, '../../../cli/data/eval-dataset.json')
const dataset: DatasetSample[] = JSON.parse(readFileSync(datasetPath, 'utf-8'))

console.log('Loaded ' + dataset.length + ' samples for alignment eval')

// Cache app configs
const appCache = new Map<string, any>()

async function getAppConfig(slug: string) {
  if (appCache.has(slug)) return appCache.get(slug)
  const app = await database.query.AppsTable.findFirst({
    where: (apps, { eq }) => eq(apps.slug, slug),
  })
  appCache.set(slug, app)
  return app
}

// Scorer: Does local agent produce similar behavior?
const behaviorAlignment = {
  name: 'Behavior Alignment',
  scorer: async ({
    input,
    output,
    expected,
  }: {
    input: { message: string; subject: string; app: string }
    output: { response: string | null; toolCalls: string[] }
    expected?: string
  }) => {
    const prodHadResponse = expected && expected.length > 0
    const localHadResponse = output.response && output.response.length > 0

    // Both responded or both didn't = aligned
    if (prodHadResponse === localHadResponse) {
      return { score: 1, metadata: { aligned: true } }
    }

    // Local didn't respond but prod did = local improved (silent skip)
    if (!localHadResponse && prodHadResponse) {
      // Check if prod response had leakage
      const leakPatterns =
        /no instructor|can.t route|routing configured|per my guidelines/i
      if (leakPatterns.test(expected)) {
        return { score: 1, metadata: { improved: 'silent_skip_vs_leak' } }
      }
    }

    return {
      score: 0,
      metadata: { aligned: false, prodHadResponse, localHadResponse },
    }
  },
}

// Scorer: No internal leakage in local output
const noLeakage = {
  name: 'No Internal Leakage',
  scorer: async ({ output }: { output: { response: string | null } }) => {
    if (!output.response) return { score: 1 }
    const leakPatterns =
      /no instructor|can.t route|routing configured|per my guidelines|I won.t respond/i
    return {
      score: leakPatterns.test(output.response) ? 0 : 1,
      metadata: { hasLeakage: leakPatterns.test(output.response) },
    }
  },
}

evalite('Agent Alignment - Local vs Prod', {
  data: dataset.slice(0, 10).map((sample) => ({
    input: {
      message: sample.triggerMessage.body,
      subject: sample.triggerMessage.subject,
      app: sample.app === 'unknown' ? 'ai-hero' : sample.app,
    },
    expected: sample.agentResponse.text,
  })),

  task: async (input) => {
    const app = await getAppConfig(input.app)
    if (!app) {
      return { response: null, toolCalls: [] }
    }

    const client = new IntegrationClient({
      baseUrl: app.integration_base_url,
      webhookSecret: app.webhook_secret,
    })

    try {
      const result = await runSupportAgent({
        message: 'Subject: ' + input.subject + '\n\n' + input.message,
        conversationHistory: [],
        customerContext: { email: '[EMAIL]' },
        appId: input.app,
        model: 'anthropic/claude-haiku-4-5', // Fast model for evals
        integrationClient: client,
        appConfig: {
          instructor_teammate_id: app.instructor_teammate_id,
          stripeAccountId: app.stripe_account_id,
        },
      })

      return {
        response: result.response,
        toolCalls: result.toolCalls.map((tc) => tc.name),
      }
    } catch (e) {
      return { response: null, toolCalls: [], error: String(e) }
    }
  },

  scorers: [behaviorAlignment, noLeakage],
})
