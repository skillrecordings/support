/**
 * End-to-end pipeline evaluation
 *
 * Runs full pipeline against production scenarios and scores quality.
 */

import { readFile, writeFile } from 'fs/promises'
import { runPipeline } from '../index'
import { validateSync } from '../steps/validate'
import type { EvalSummary, GatherOutput, PipelineOutput } from '../types'

// ============================================================================
// Types
// ============================================================================

interface E2EScenario {
  id: string
  triggerMessage: {
    subject: string
    body: string
  }
  agentResponse?: {
    text: string
  }
  conversationHistory?: Array<{
    direction: 'in' | 'out'
    body: string
  }>
}

interface E2EResult {
  id: string
  subject: string
  action: string
  response?: string
  passed: boolean
  validationIssues: string[]
  durationMs: number
  steps: string[]
}

// ============================================================================
// Run e2e eval
// ============================================================================

export interface E2EEvalOptions {
  dataset: string
  output?: string
  verbose?: boolean
  json?: boolean
  limit?: number
  model?: string
}

export async function runE2EEval(
  options: E2EEvalOptions
): Promise<EvalSummary> {
  const {
    dataset,
    output,
    verbose,
    json,
    limit,
    model = 'anthropic/claude-haiku-4-5',
  } = options

  const content = await readFile(dataset, 'utf-8')
  let scenarios: E2EScenario[] = JSON.parse(content)

  if (limit) {
    scenarios = scenarios.slice(0, limit)
  }

  if (!json) {
    console.log(
      `\n🚀 Running e2e eval on ${scenarios.length} scenarios (model: ${model})\n`
    )
  }

  const results: E2EResult[] = []
  const startTime = Date.now()

  let passed = 0
  let failed = 0
  let silenced = 0
  let escalated = 0

  for (let i = 0; i < scenarios.length; i++) {
    const scenario = scenarios[i]
    if (!scenario) continue

    if (!json) {
      process.stdout.write(`\r  Processing ${i + 1}/${scenarios.length}...`)
    }

    const scenarioStart = Date.now()

    try {
      const pipelineResult = await runPipeline(
        {
          message: {
            subject: scenario.triggerMessage.subject,
            body: scenario.triggerMessage.body,
          },
          appConfig: {
            appId: 'total-typescript',
            instructorConfigured: true,
            autoSendEnabled: false,
          },
          dryRun: true,
        },
        {
          draftModel: model,
          classifyModel: model,
        }
      )

      // Track action distribution
      if (pipelineResult.action === 'silence') silenced++
      else if (pipelineResult.action.startsWith('escalate')) escalated++

      // If we got a response, validate it
      let validationIssues: string[] = []
      let scenarioPassed = true

      if (pipelineResult.response) {
        // Create minimal context for validation
        const emptyContext: GatherOutput = {
          user: null,
          purchases: [],
          knowledge: [],
          history: [],
          priorMemory: [],
          priorConversations: [],
          gatherErrors: [],
        }

        const validationResult = validateSync({
          draft: pipelineResult.response,
          context: emptyContext,
        })

        validationIssues = validationResult.issues.map(
          (i) => `${i.type}: ${i.match || i.message}`
        )
        scenarioPassed = validationResult.valid
      }

      if (scenarioPassed) passed++
      else failed++

      results.push({
        id: scenario.id,
        subject: scenario.triggerMessage.subject.slice(0, 60),
        action: pipelineResult.action,
        response: pipelineResult.response,
        passed: scenarioPassed,
        validationIssues,
        durationMs: Date.now() - scenarioStart,
        steps: pipelineResult.steps.map(
          (s) => `${s.step}:${s.success ? '✓' : '✗'}`
        ),
      })

      if (verbose && !scenarioPassed) {
        console.log(`\n❌ ${scenario.triggerMessage.subject.slice(0, 50)}...`)
        for (const issue of validationIssues) {
          console.log(`   └─ ${issue}`)
        }
      }
    } catch (error) {
      failed++
      results.push({
        id: scenario.id,
        subject: scenario.triggerMessage.subject.slice(0, 60),
        action: 'error',
        passed: false,
        validationIssues: [
          error instanceof Error ? error.message : 'Unknown error',
        ],
        durationMs: Date.now() - scenarioStart,
        steps: [],
      })
    }
  }

  if (!json) {
    console.log('\n')
  }

  const totalDuration = Date.now() - startTime
  const total = scenarios.length
  const passRate = total > 0 ? passed / total : 0

  // Calculate latency percentiles
  const durations = results.map((r) => r.durationMs).sort((a, b) => a - b)
  const latency = {
    p50: durations[Math.floor(durations.length * 0.5)] || 0,
    p95: durations[Math.floor(durations.length * 0.95)] || 0,
    p99: durations[Math.floor(durations.length * 0.99)] || 0,
  }

  const summary: EvalSummary & {
    silenced: number
    escalated: number
    responded: number
    latency: { p50: number; p95: number; p99: number }
  } = {
    total,
    passed,
    failed,
    passRate,
    durationMs: totalDuration,
    silenced,
    escalated,
    responded: total - silenced - escalated,
    latency,
  }

  if (output) {
    await writeFile(output, JSON.stringify({ summary, results }, null, 2))
    if (!json) console.log(`Results saved to ${output}`)
  }

  if (json) {
    console.log(JSON.stringify({ summary, results }, null, 2))
  } else {
    console.log('🚀 E2E Pipeline Eval Results\n')
    console.log(`Total: ${total}`)
    console.log(`  ✅ Passed:    ${passed} (${(passRate * 100).toFixed(1)}%)`)
    console.log(`  ❌ Failed:    ${failed}`)
    console.log('')
    console.log('Action Distribution:')
    console.log(`  📝 Responded: ${summary.responded}`)
    console.log(`  🤫 Silenced:  ${silenced}`)
    console.log(`  👋 Escalated: ${escalated}`)
    console.log('')
    console.log('Latency:')
    console.log(`  p50: ${latency.p50}ms`)
    console.log(`  p95: ${latency.p95}ms`)
    console.log(`  p99: ${latency.p99}ms`)
    console.log('')
    console.log(`Total time: ${(totalDuration / 1000).toFixed(1)}s`)
  }

  return summary
}
