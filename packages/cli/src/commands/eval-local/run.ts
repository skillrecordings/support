/**
 * Run eval suite against local environment
 *
 * Scenario-aware mocks that analyze trigger messages to return
 * contextually appropriate data. No more static canned responses.
 */

import { SUPPORT_AGENT_PROMPT } from '@skillrecordings/core/agent'
import {
  BannedPhrases,
  Helpfulness,
  InternalStateLeakage,
  MetaCommentary,
  ProductFabrication,
} from '@skillrecordings/core/evals/scorers'
import { generateText, stepCountIs, tool } from 'ai'
import { readFile, writeFile } from 'fs/promises'
import { glob } from 'glob'
import { z } from 'zod'
import { cleanupRealTools, createRealTools, initRealTools } from './real-tools'

interface RunOptions {
  scenarios?: string
  dataset?: string
  output?: string
  baseline?: string
  failThreshold?: number
  verbose?: boolean
  json?: boolean
  prompt?: string
  model?: string
  limit?: number
  realTools?: boolean // Use real Docker services instead of mocks
}

interface Scenario {
  id: string
  name?: string
  subject?: string
  appId?: string
  trigger?: {
    subject: string
    body: string
  }
  triggerMessage?: {
    subject: string
    body: string
  }
  expectedBehavior?: string
  category?: string
  // Additional context from dataset
  agentResponse?: {
    text: string
    category: string
  }
  conversationHistory?: Array<{
    direction: 'in' | 'out'
    body: string
    timestamp: number
  }>
}

interface ScenarioResult {
  id: string
  name: string
  passed: boolean
  durationMs: number
  output: string
  toolCalls: string[]
  noDraft: boolean
  scores: {
    internalLeaks: { passed: boolean; matches: string[] }
    metaCommentary: { passed: boolean; matches: string[] }
    bannedPhrases: { passed: boolean; matches: string[] }
    fabrication: { passed: boolean; matches: string[] }
    helpfulness: { score: number }
  }
  category: string
  failureReasons: string[]
}

interface RunSummary {
  total: number
  passed: number
  failed: number
  noDraft: number
  passRate: number
  durationMs: number
  byCategory: Record<
    string,
    { passed: number; failed: number; noDraft: number }
  >
  failures: {
    internalLeaks: number
    metaCommentary: number
    bannedPhrases: number
    fabrication: number
  }
  latency: {
    p50: number
    p95: number
    p99: number
  }
}

/**
 * Scenario classifier - analyzes message content to determine
 * what type of support request this is
 */
type ScenarioType =
  | 'access_issue' // Can't access, lost access, login problems
  | 'refund_request' // Wants money back
  | 'transfer_request' // Move purchase to different email
  | 'technical_help' // How do I use X, code questions
  | 'product_inquiry' // What's included, pricing, availability
  | 'zoom_link' // Missing workshop/event access
  | 'invoice_request' // Need invoice, receipt
  | 'fan_mail' // Personal message to instructor
  | 'spam' // Vendor outreach, not real support
  | 'general' // Catch-all

function classifyScenario(subject: string, body: string): ScenarioType {
  // Normalize text - remove newlines, extra spaces
  const text = `${subject} ${body}`.toLowerCase().replace(/\s+/g, ' ')

  // Access issues
  if (
    text.includes("don't have access") ||
    text.includes("can't access") ||
    text.includes('lost access') ||
    text.includes('no access') ||
    text.includes("can't log in") ||
    text.includes('cannot login') ||
    text.includes('restore access') ||
    text.includes('logging in with github') ||
    text.includes('login with github') ||
    text.includes('logged in with github') ||
    text.includes('different email') ||
    text.includes('restore the access')
  ) {
    return 'access_issue'
  }

  // Refund requests
  if (
    text.includes('refund') ||
    text.includes('money back') ||
    (text.includes('cancel') && text.includes('purchase')) ||
    text.includes('charge back') ||
    text.includes("didn't mean to buy")
  ) {
    return 'refund_request'
  }

  // Transfer requests
  if (
    text.includes('transfer') ||
    (text.includes('move') && text.includes('email')) ||
    text.includes('change email') ||
    text.includes('wrong email')
  ) {
    return 'transfer_request'
  }

  // Zoom/workshop access
  if (
    text.includes('zoom') ||
    (text.includes('workshop') &&
      (text.includes('link') || text.includes('access'))) ||
    text.includes('calendar invite') ||
    text.includes('live event')
  ) {
    return 'zoom_link'
  }

  // Invoice/receipt
  if (
    text.includes('invoice') ||
    text.includes('receipt') ||
    (text.includes('tax') && text.includes('document'))
  ) {
    return 'invoice_request'
  }

  // Product inquiry
  if (
    text.includes('sold out') ||
    (text.includes('buy') && text.includes('button')) ||
    text.includes('discount') ||
    text.includes('pricing') ||
    text.includes("what's included") ||
    text.includes("what's the difference")
  ) {
    return 'product_inquiry'
  }

  // Technical help
  if (
    text.includes('how do i') ||
    text.includes('how to') ||
    text.includes('error') ||
    text.includes('not working') ||
    (text.includes('typescript') && text.includes('help')) ||
    text.includes('code') ||
    text.includes('tutorial')
  ) {
    return 'technical_help'
  }

  // Fan mail / personal
  if (
    (text.includes('thank you') && text.includes('course')) ||
    text.includes('changed my career') ||
    text.includes('love your') ||
    text.includes('big fan') ||
    text.includes('appreciate')
  ) {
    return 'fan_mail'
  }

  // Spam/vendor
  if (
    text.includes('partnership') ||
    text.includes('sponsor') ||
    text.includes('backlink') ||
    text.includes('seo') ||
    text.includes('guest post')
  ) {
    return 'spam'
  }

  return 'general'
}

/**
 * Create scenario-aware mock tools
 *
 * Each scenario type gets appropriate mock responses that
 * trigger realistic agent behavior
 */
function createMockTools(scenarioType: ScenarioType, scenario: Scenario) {
  const trigger = scenario.trigger ||
    scenario.triggerMessage || { subject: '', body: '' }

  // Extract email from trigger if present
  const emailMatch = trigger.body.match(
    /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/
  )
  const customerEmail = emailMatch?.[1] || '[EMAIL]'

  return {
    lookupUser: tool({
      description: 'Look up user by email',
      inputSchema: z.object({
        email: z.string(),
        appId: z.string(),
      }),
      execute: async ({ email }) => {
        // Scenario-aware responses
        switch (scenarioType) {
          case 'access_issue':
            // User found but no purchase - classic "different email" scenario
            if (
              trigger.body.toLowerCase().includes('different email') ||
              trigger.body.toLowerCase().includes('github')
            ) {
              return {
                found: true,
                user: { id: 'user_123', email, name: 'Customer' },
                purchases: [], // No purchases - that's the problem!
              }
            }
            // Otherwise user might have purchase but access issue
            return {
              found: true,
              user: { id: 'user_123', email, name: 'Customer' },
              purchases: [
                {
                  id: 'purch_1',
                  product:
                    scenario.appId === 'ai-hero'
                      ? 'AI Hero Workshop'
                      : 'Total TypeScript',
                  date: '2025-12-15',
                  status: 'active',
                },
              ],
            }

          case 'refund_request':
            // User with recent purchase
            return {
              found: true,
              user: { id: 'user_123', email, name: 'Customer' },
              purchases: [
                {
                  id: 'purch_refund_1',
                  product:
                    scenario.appId === 'ai-hero'
                      ? 'AI Hero Workshop'
                      : 'Total TypeScript Pro',
                  date: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
                    .toISOString()
                    .split('T')[0], // 7 days ago
                  status: 'active',
                  amount: 249,
                },
              ],
            }

          case 'transfer_request':
            return {
              found: true,
              user: { id: 'user_123', email, name: 'Customer' },
              purchases: [
                {
                  id: 'purch_transfer_1',
                  product: 'Total TypeScript',
                  date: '2025-01-10',
                  status: 'active',
                },
              ],
            }

          case 'zoom_link':
          case 'product_inquiry':
          case 'technical_help':
          case 'invoice_request':
            // Found with purchase
            return {
              found: true,
              user: { id: 'user_123', email, name: 'Customer' },
              purchases: [
                {
                  id: 'purch_1',
                  product:
                    scenario.appId === 'ai-hero'
                      ? 'Ralph Workshop Ticket'
                      : 'Total TypeScript',
                  date: '2025-01-15',
                  status: 'active',
                },
              ],
            }

          case 'fan_mail':
          case 'spam':
            // Might not even need to look up
            return {
              found: false,
              user: null,
              purchases: [],
            }

          default:
            return {
              found: true,
              user: { id: 'user_123', email, name: 'Customer' },
              purchases: [
                {
                  id: 'purch_1',
                  product: 'Total TypeScript',
                  date: '2025-01-01',
                  status: 'active',
                },
              ],
            }
        }
      },
    }),

    searchKnowledge: tool({
      description: 'Search knowledge base',
      inputSchema: z.object({ query: z.string(), appId: z.string() }),
      execute: async ({ query }) => {
        // Return relevant knowledge for technical questions
        if (scenarioType === 'technical_help') {
          return {
            similarTickets: [
              {
                data: 'Similar question answered: Check the TypeScript handbook section on generics.',
                score: 0.85,
              },
            ],
            knowledge: [
              {
                data: 'For TypeScript fundamentals, start with the Beginner TypeScript tutorial.',
                score: 0.9,
              },
            ],
            goodResponses: [
              {
                data: 'Example response: "For that specific error, try narrowing the type first..."',
                score: 0.8,
              },
            ],
          }
        }

        // Minimal/empty for other scenarios to avoid fabrication
        return {
          similarTickets: [],
          knowledge: [],
          goodResponses: [],
        }
      },
    }),

    searchProductContent: tool({
      description: 'Search product content',
      inputSchema: z.object({ query: z.string() }),
      execute: async ({ query }) => {
        if (scenarioType === 'technical_help') {
          return {
            results: [
              {
                title: 'Beginner TypeScript Tutorial',
                type: 'course',
                url: 'https://totaltypescript.com/tutorials/beginners-typescript',
              },
            ],
          }
        }
        return { results: [] }
      },
    }),

    draftResponse: tool({
      description: 'Draft a response to send to customer',
      inputSchema: z.object({ body: z.string() }),
      execute: async ({ body }) => ({ drafted: true, body }),
    }),

    escalateToHuman: tool({
      description: 'Escalate to human support',
      inputSchema: z.object({
        reason: z.string(),
        urgency: z.enum(['low', 'medium', 'high']),
      }),
      execute: async ({ reason, urgency }) => ({
        escalated: true,
        reason,
        urgency,
      }),
    }),

    assignToInstructor: tool({
      description:
        'Assign conversation to instructor for personal correspondence',
      inputSchema: z.object({
        conversationId: z.string(),
        reason: z.string(),
      }),
      execute: async ({ conversationId, reason }) => ({
        status: 'pending_approval',
        conversationId,
        reason,
        message: 'Instructor assignment submitted for approval',
      }),
    }),

    memory_search: tool({
      description: 'Search semantic memory',
      inputSchema: z.object({ query: z.string() }),
      execute: async () => ({ results: [], total: 0 }),
    }),

    memory_store: tool({
      description: 'Store learning in memory',
      inputSchema: z.object({
        content: z.string(),
        tags: z.array(z.string()).optional(),
      }),
      execute: async () => ({ stored: true, id: 'mem_mock_1' }),
    }),

    memory_vote: tool({
      description: 'Vote on memory usefulness',
      inputSchema: z.object({
        memoryId: z.string(),
        vote: z.enum(['up', 'down']),
      }),
      execute: async () => ({ success: true }),
    }),

    memory_cite: tool({
      description: 'Cite a memory as used',
      inputSchema: z.object({ memoryId: z.string() }),
      execute: async () => ({ cited: true }),
    }),

    processRefund: tool({
      description: 'Process a refund',
      inputSchema: z.object({
        purchaseId: z.string(),
        appId: z.string(),
        reason: z.string(),
      }),
      execute: async ({ purchaseId, reason }) => ({
        status: 'pending_approval',
        purchaseId,
        reason,
        message: 'Refund submitted for approval',
      }),
    }),

    transferPurchase: tool({
      description: 'Transfer purchase to another email',
      inputSchema: z.object({
        purchaseId: z.string(),
        appId: z.string(),
        fromUserId: z.string(),
        toEmail: z.string(),
        reason: z.string(),
      }),
      execute: async () => ({
        status: 'pending_approval',
        message: 'Transfer submitted for approval',
      }),
    }),

    check_product_availability: tool({
      description: 'Check if product is available or sold out',
      inputSchema: z.object({
        productId: z.string().optional(),
        appId: z.string(),
      }),
      execute: async () => {
        // Default: available
        if (scenarioType === 'product_inquiry') {
          return {
            soldOut: false,
            quantityRemaining: 12,
            quantityAvailable: 50,
            enrollmentOpen: true,
          }
        }
        return {
          soldOut: false,
          quantityRemaining: -1, // unlimited
          enrollmentOpen: true,
        }
      },
    }),

    getPaymentHistory: tool({
      description: 'Get payment history from Stripe',
      inputSchema: z.object({
        customerEmail: z.string(),
        limit: z.number().optional(),
      }),
      execute: async () => ({
        charges: [
          {
            id: 'ch_mock_1',
            amount: 24900,
            status: 'succeeded',
            created: Date.now() - 7 * 24 * 60 * 60 * 1000,
          },
        ],
      }),
    }),

    getSubscriptionStatus: tool({
      description: 'Get subscription status',
      inputSchema: z.object({
        customerId: z.string(),
        stripeAccountId: z.string(),
      }),
      execute: async () => ({
        subscription: null, // Most products aren't subscriptions
      }),
    }),

    lookupCharge: tool({
      description: 'Look up specific charge',
      inputSchema: z.object({ chargeId: z.string() }),
      execute: async ({ chargeId }) => ({
        charge: {
          id: chargeId,
          amount: 24900,
          status: 'succeeded',
          refunded: false,
        },
      }),
    }),

    verifyRefund: tool({
      description: 'Verify refund status',
      inputSchema: z.object({ refundId: z.string() }),
      execute: async ({ refundId }) => ({
        refund: {
          id: refundId,
          status: 'succeeded',
          amount: 24900,
        },
      }),
    }),
  }
}

export async function run(options: RunOptions): Promise<void> {
  const {
    scenarios: scenarioGlob,
    dataset: datasetPath,
    output,
    baseline,
    failThreshold = 0.8,
    verbose = false,
    json = false,
    prompt: promptPath,
    model = 'anthropic/claude-haiku-4-5',
    limit,
    realTools = false,
  } = options

  // Initialize real tools if flag is set
  if (realTools) {
    if (!json) console.log('🔧 Using REAL tools (Docker services)...')
    try {
      await initRealTools()
      if (!json) console.log('✅ Connected to MySQL and Qdrant')
    } catch (error) {
      console.error('❌ Failed to connect to Docker services:', error)
      console.error(
        '   Make sure services are running: docker compose -f docker/eval.yml up -d'
      )
      process.exit(1)
    }
  }

  // Load prompt
  let systemPrompt = SUPPORT_AGENT_PROMPT
  if (promptPath) {
    systemPrompt = await readFile(promptPath, 'utf-8')
    if (!json) console.log(`Using prompt from: ${promptPath}`)
  } else {
    if (!json) console.log('Using production prompt')
  }

  // Load scenarios from either scenarios glob or dataset file
  let scenarios: Scenario[] = []

  if (datasetPath) {
    // Load from dataset file (comprehensive-dataset.json format)
    const datasetContent = await readFile(datasetPath, 'utf-8')
    const dataset = JSON.parse(datasetContent)
    scenarios = dataset.map((item: any) => {
      const trigger = item.triggerMessage || {
        subject: item.subject || '',
        body: '',
      }
      const fullText = `${trigger.subject} ${trigger.body}`.toLowerCase()

      // Detect app from content
      let detectedApp = 'total-typescript'
      if (
        fullText.includes('ai hero') ||
        fullText.includes('aihero.dev') ||
        fullText.includes('ai-hero') ||
        fullText.includes('ralph') ||
        fullText.includes('autonomous software engineers')
      ) {
        detectedApp = 'ai-hero'
      }

      return {
        id: item.id || item.conversationId,
        name: trigger.subject || 'Unknown',
        trigger,
        triggerMessage: item.triggerMessage,
        category: item.category || 'general',
        appId: item.app !== 'unknown' ? item.app : detectedApp,
        agentResponse: item.agentResponse,
        conversationHistory: item.conversationHistory,
      }
    })
  } else {
    // Load from scenario files
    const glob_ = scenarioGlob || 'fixtures/scenarios/**/*.json'
    const scenarioFiles = await glob(glob_)

    if (scenarioFiles.length === 0) {
      console.error('No scenarios found. Use --scenarios or --dataset')
      process.exit(1)
    }

    scenarios = await Promise.all(
      scenarioFiles.map(async (file) => {
        const content = await readFile(file, 'utf-8')
        return JSON.parse(content)
      })
    )
  }

  // Apply limit
  if (limit && limit < scenarios.length) {
    scenarios = scenarios.slice(0, limit)
  }

  if (!json) {
    console.log(
      `\n🧪 Running ${scenarios.length} scenarios (model: ${model})\n`
    )
  }

  const startTime = Date.now()
  const results: ScenarioResult[] = []

  for (let i = 0; i < scenarios.length; i++) {
    if (!json) {
      process.stdout.write(`\r  Processing ${i + 1}/${scenarios.length}...`)
    }

    const scenario = scenarios[i]
    if (!scenario) continue
    const result = await runScenario(
      scenario,
      systemPrompt,
      model,
      verbose,
      realTools
    )
    results.push(result)
  }

  // Cleanup real tools if used
  if (realTools) {
    await cleanupRealTools()
  }

  if (!json) {
    console.log('\n')
  }

  const totalDuration = Date.now() - startTime
  const summary = aggregateResults(results, totalDuration)

  // Compare to baseline if provided
  if (baseline) {
    try {
      const baselineContent = await readFile(baseline, 'utf-8')
      const baselineData = JSON.parse(baselineContent)
      printComparison(summary, baselineData.summary || baselineData)
    } catch (e) {
      console.error('Could not load baseline:', e)
    }
  }

  // Save results if output specified
  if (output) {
    await writeFile(output, JSON.stringify({ summary, results }, null, 2))
    if (!json) {
      console.log(`Results saved to ${output}`)
    }
  }

  if (json) {
    console.log(JSON.stringify({ summary, results }, null, 2))
  } else {
    printSummary(summary, failThreshold)

    // Show failures if verbose
    if (verbose) {
      const failures = results.filter((r) => !r.passed && !r.noDraft)
      if (failures.length > 0) {
        console.log('\n--- FAILURES ---\n')
        for (const f of failures.slice(0, 10)) {
          console.log(`❌ ${f.name}`)
          for (const reason of f.failureReasons) {
            console.log(`   └─ ${reason}`)
          }
          if (f.output) {
            console.log(`   Output: ${f.output.slice(0, 150)}...`)
          }
          console.log('')
        }
      }
    }
  }

  // Exit with error if below threshold
  const effectivePassRate =
    summary.passed / (summary.passed + summary.failed) || 0
  if (effectivePassRate < failThreshold && summary.failed > 0) {
    process.exit(1)
  }
}

async function runScenario(
  scenario: Scenario,
  systemPrompt: string,
  model: string,
  verbose?: boolean,
  useRealTools?: boolean
): Promise<ScenarioResult> {
  const startTime = Date.now()
  const failureReasons: string[] = []

  // Build input message
  const trigger = scenario.trigger ||
    scenario.triggerMessage || { subject: '', body: '' }
  const input = `Subject: ${trigger.subject}\n\n${trigger.body}`
  const name = scenario.name || trigger.subject || scenario.id

  // Classify scenario and create appropriate tools (mock or real)
  const scenarioType = classifyScenario(trigger.subject, trigger.body)
  if (verbose) {
    console.log(
      `[CLASSIFY] "${trigger.subject.slice(0, 50)}..." → ${scenarioType}`
    )
    if (useRealTools) {
      console.log(`[TOOLS] Using REAL Docker services`)
    }
  }

  // Use real tools if flag is set, otherwise use mocks
  const tools = useRealTools
    ? createRealTools({
        appId: scenario.appId,
        customerEmail: trigger.body.match(
          /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/
        )?.[1],
      })
    : createMockTools(scenarioType, scenario)

  // Use scenarioType as category for better tracking
  const category = scenarioType

  let output = ''
  let toolCalls: string[] = []
  let noDraft = false

  try {
    // Add explicit tool requirement - the LLM must use draftResponse, not text output
    const evalSystemPrompt =
      systemPrompt +
      `

## CRITICAL: Tool Usage Requirements
1. You MUST use draftResponse to send ANY reply to the customer
2. NEVER output text responses directly - you are in a tool-use only mode
3. Your only outputs should be tool calls. No explanatory text.
4. If you want to respond to the customer, call draftResponse with the response body
5. If you decide not to respond, make no tool calls at all

Think step by step:
1. Analyze the customer message
2. Call relevant tools (lookupUser, searchKnowledge, etc.)
3. Based on tool results, either:
   - Call draftResponse with your reply, OR
   - Make no response (for spam, vendor emails, already handled, etc.)

App: ${scenario.appId || 'total-typescript'}`

    const result = await generateText({
      model,
      system: evalSystemPrompt,
      messages: [{ role: 'user', content: input }],
      tools,
      stopWhen: stepCountIs(10), // Match production - use stopWhen for multi-step
    })

    // Extract tool calls
    toolCalls = result.steps
      .flatMap((s) => s.toolCalls || [])
      .map((tc) => tc.toolName)

    // Debug all steps when verbose
    if (verbose) {
      console.log(
        `\n[TRACE] ${name} (${result.steps.length} steps, reason: ${result.finishReason})`
      )
      for (let i = 0; i < result.steps.length; i++) {
        const step = result.steps[i]
        if (!step) continue
        const calls = (step.toolCalls || [])
          .map((tc) => `${tc.toolName}`)
          .join(', ')
        console.log(
          `  Step ${i + 1}: ${calls || 'no tool calls'} [reason: ${step.finishReason}]`
        )
        for (const tr of step.toolResults || []) {
          const preview = JSON.stringify(tr.output).slice(0, 300)
          console.log(`    → ${preview}`)
        }
        if (step.text) {
          console.log(`    text: ${step.text.slice(0, 100)}...`)
        }
      }
    }

    // Find draftResponse output - this is the only way to send to customers
    // Text output without draftResponse is internal reasoning (not sent)
    const draftCall = result.steps
      .flatMap((s) => s.toolCalls || [])
      .find((tc) => tc.toolName === 'draftResponse')

    if (draftCall) {
      // Explicit draft call - this is a customer response
      output = (draftCall.input as { body: string }).body
      if (verbose) {
        console.log(`  ✅ DRAFTED: ${output.slice(0, 100)}...`)
      }
    } else {
      // No draftResponse = correctly silent (even if there's reasoning text)
      noDraft = true
      if (verbose) {
        if (result.text && result.text.trim().length > 0) {
          console.log(`  🚫 SILENT (reasoning): ${result.text.slice(0, 80)}...`)
        } else {
          console.log(`  🚫 SILENT (no output)`)
        }
      }
    }
  } catch (error) {
    output = `ERROR: ${error instanceof Error ? error.message : 'Unknown error'}`
    failureReasons.push(output)
  }

  const durationMs = Date.now() - startTime

  // Run quality scorers on output
  const leakResult = InternalStateLeakage({ output })
  const metaResult = MetaCommentary({ output })
  const bannedResult = BannedPhrases({ output })
  const fabResult = ProductFabrication({ output })
  const helpResult = Helpfulness({ output })

  const scores = {
    internalLeaks: {
      passed: leakResult.score === 1,
      matches: leakResult.metadata?.foundLeaks || [],
    },
    metaCommentary: {
      passed: metaResult.score === 1,
      matches: metaResult.metadata?.foundMeta || [],
    },
    bannedPhrases: {
      passed: bannedResult.score === 1,
      matches: bannedResult.metadata?.foundBanned || [],
    },
    fabrication: {
      passed: fabResult.score === 1,
      matches: fabResult.metadata?.foundFabrication || [],
    },
    helpfulness: {
      score: helpResult.score,
    },
  }

  // Build failure reasons
  if (!scores.internalLeaks.passed) {
    failureReasons.push(
      `Internal leak: ${scores.internalLeaks.matches.join(', ')}`
    )
  }
  if (!scores.metaCommentary.passed) {
    failureReasons.push(
      `Meta commentary: ${scores.metaCommentary.matches.join(', ')}`
    )
  }
  if (!scores.bannedPhrases.passed) {
    failureReasons.push(
      `Banned phrase: ${scores.bannedPhrases.matches.join(', ')}`
    )
  }
  if (!scores.fabrication.passed) {
    failureReasons.push(`Fabrication: ${scores.fabrication.matches.join(', ')}`)
  }

  // Determine pass/fail based on expectedBehavior
  // Check if agent behavior matches what the scenario expects
  const expectedBehavior = scenario.expectedBehavior?.toLowerCase() || ''

  // Expected to draft a response?
  const shouldDraft =
    expectedBehavior.includes('draft') ||
    expectedBehavior.includes('respond') ||
    expectedBehavior.includes('help') ||
    expectedBehavior.includes('ask_for_details')

  // Expected to stay silent?
  const shouldBeSilent =
    expectedBehavior.includes('silent') ||
    expectedBehavior.includes('ignore') ||
    expectedBehavior.includes('no_response')

  // Expected to escalate?
  const shouldEscalate =
    expectedBehavior.includes('escalate') ||
    expectedBehavior.includes('human') ||
    expectedBehavior.includes('approval')

  // Check for escalation in tool calls
  const didEscalate =
    toolCalls.includes('escalateToHuman') ||
    toolCalls.includes('assignToInstructor')

  let passed = true

  // If expected draft but got silence → FAIL
  if (shouldDraft && noDraft) {
    passed = false
    failureReasons.push('Expected draft response but agent stayed silent')
  }

  // If expected silence but got draft → check draft quality
  if (shouldBeSilent && !noDraft) {
    // Draft when should be silent is a failure
    passed = false
    failureReasons.push('Expected silence but agent drafted a response')
  }

  // If expected escalate but didn't → FAIL
  if (shouldEscalate && !didEscalate) {
    passed = false
    failureReasons.push('Expected escalation but agent did not escalate')
  }

  // If drafted, also check quality
  if (!noDraft) {
    if (!scores.internalLeaks.passed) passed = false
    if (!scores.metaCommentary.passed) passed = false
    if (!scores.bannedPhrases.passed) passed = false
    if (!scores.fabrication.passed) passed = false
  }

  // If no expectedBehavior specified, fall back to old logic
  if (!expectedBehavior) {
    passed =
      noDraft ||
      (scores.internalLeaks.passed &&
        scores.metaCommentary.passed &&
        scores.bannedPhrases.passed &&
        scores.fabrication.passed)
  }

  return {
    id: scenario.id,
    name,
    passed,
    durationMs,
    output,
    toolCalls,
    noDraft,
    scores,
    category,
    failureReasons,
  }
}

function aggregateResults(
  results: ScenarioResult[],
  totalDurationMs: number
): RunSummary {
  const passed = results.filter((r) => r.passed).length
  const noDraft = results.filter((r) => r.noDraft && r.passed).length // Only count as noDraft if also passed
  const failed = results.filter((r) => !r.passed).length // Failed is anything that didn't pass

  // Group by category
  const byCategory: Record<
    string,
    { passed: number; failed: number; noDraft: number }
  > = {}
  for (const result of results) {
    const category = result.category || 'general'
    if (!byCategory[category]) {
      byCategory[category] = { passed: 0, failed: 0, noDraft: 0 }
    }
    if (result.noDraft) {
      byCategory[category].noDraft++
    } else if (result.passed) {
      byCategory[category].passed++
    } else {
      byCategory[category].failed++
    }
  }

  // Count failure types (only for non-noDraft results)
  const withDrafts = results.filter((r) => !r.noDraft)
  const failures = {
    internalLeaks: withDrafts.filter((r) => !r.scores.internalLeaks.passed)
      .length,
    metaCommentary: withDrafts.filter((r) => !r.scores.metaCommentary.passed)
      .length,
    bannedPhrases: withDrafts.filter((r) => !r.scores.bannedPhrases.passed)
      .length,
    fabrication: withDrafts.filter((r) => !r.scores.fabrication.passed).length,
  }

  // Calculate latency percentiles
  const durations = results.map((r) => r.durationMs).sort((a, b) => a - b)
  const latency = {
    p50: durations[Math.floor(durations.length * 0.5)] || 0,
    p95: durations[Math.floor(durations.length * 0.95)] || 0,
    p99: durations[Math.floor(durations.length * 0.99)] || 0,
  }

  return {
    total: results.length,
    passed,
    failed,
    noDraft,
    passRate: results.length > 0 ? passed / results.length : 0,
    durationMs: totalDurationMs,
    byCategory,
    failures,
    latency,
  }
}

function printSummary(summary: RunSummary, threshold: number): void {
  console.log('🧪 Eval Results\n')
  console.log(`Scenarios: ${summary.total} total`)
  console.log(
    `  ✅ Passed:    ${summary.passed} (${(summary.passRate * 100).toFixed(1)}%)`
  )
  console.log(`  ❌ Failed:    ${summary.failed}`)
  console.log(`  🚫 No draft:  ${summary.noDraft}`)

  if (summary.failed > 0) {
    console.log('\nQuality Breakdown (drafts with issues):')
    if (summary.failures.internalLeaks > 0) {
      console.log(`  🚨 Internal leaks:    ${summary.failures.internalLeaks}`)
    }
    if (summary.failures.metaCommentary > 0) {
      console.log(`  💬 Meta-commentary:   ${summary.failures.metaCommentary}`)
    }
    if (summary.failures.bannedPhrases > 0) {
      console.log(`  🚫 Banned phrases:    ${summary.failures.bannedPhrases}`)
    }
    if (summary.failures.fabrication > 0) {
      console.log(`  🎭 Fabrication:       ${summary.failures.fabrication}`)
    }
  }

  console.log('\nBy Category:')
  for (const [cat, stats] of Object.entries(summary.byCategory)) {
    const total = stats.passed + stats.failed + stats.noDraft
    console.log(
      `  ${cat}: ${stats.passed}✅ ${stats.failed}❌ ${stats.noDraft}🚫 (${total} total)`
    )
  }

  console.log('\nLatency:')
  console.log(`  p50: ${summary.latency.p50}ms`)
  console.log(`  p95: ${summary.latency.p95}ms`)
  console.log(`  p99: ${summary.latency.p99}ms`)

  const effectivePassRate =
    summary.passed / (summary.passed + summary.failed) || 1
  const passIcon = effectivePassRate >= threshold ? '✅' : '❌'
  console.log(
    `\nDraft quality: ${(effectivePassRate * 100).toFixed(1)}% (threshold: ${(threshold * 100).toFixed(1)}%) ${passIcon}`
  )
}

function printComparison(current: RunSummary, baseline: RunSummary): void {
  console.log('\n🔬 Comparison to Baseline\n')

  const passRateDelta = current.passRate - baseline.passRate
  const passRateIcon = passRateDelta >= 0 ? '⬆️' : '⬇️'

  console.log(
    `Pass rate: ${(baseline.passRate * 100).toFixed(1)}% → ${(current.passRate * 100).toFixed(1)}%  ${passRateDelta > 0 ? '+' : ''}${(passRateDelta * 100).toFixed(1)}% ${passRateIcon}`
  )
}
