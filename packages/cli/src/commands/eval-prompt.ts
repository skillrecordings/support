/**
 * Prompt Evaluation Harness
 *
 * Tests prompt changes against real trigger messages.
 * Runs the agent with mocked tools, scores output quality.
 *
 * Usage:
 *   skill eval-prompt                           # Run with current prompt
 *   skill eval-prompt --prompt /path/to/new.md  # Test a different prompt
 *   skill eval-prompt --compare /path/to/new.md # Side-by-side comparison
 */

import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { generateText, stepCountIs, tool } from 'ai'
import type { Command } from 'commander'
import { z } from 'zod'
import { type CommandContext, createContext } from '../core/context'
import { CLIError, formatError } from '../core/errors'

// Import the current production prompt
import { SUPPORT_AGENT_PROMPT } from '@skillrecordings/core/agent'

// ============================================================================
// Quality Scorers (extracted from response-quality.eval.ts)
// ============================================================================

const leakPatterns = [
  /no instructor (configured|routing|assigned|set up)/i,
  /can't route this/i,
  /unable to route/i,
  /no (instructor|channel|inbox) (is )?configured/i,
  /system (doesn't|does not|cannot|can't)/i,
  /not configured for this app/i,
  /routing (not )?(set up|configured)/i,
  /tool (failed|error|returned)/i,
  /API (error|failed|token)/i,
  /forwarding (to|this)/i,
  /I'll note that this/i,
  /You'll want to reach out through/i,
  /should be routed/i,
  /should go to/i,
  /falls outside/i,
]

const metaPatterns = [
  /^This (is|appears to be|seems|looks like) (a |an )?(clearly )?/i,
  /I (won't|will not|shouldn't|should not) (respond|draft|reply)/i,
  /I don't need to respond/i,
  /this (should|needs to) (go to|be forwarded|be routed)/i,
  /per my guidelines/i,
  /outside (the scope|my scope|customer support)/i,
  /not a (support request|customer service issue)/i,
  /is clearly (not|meant|personal|business)/i,
  /This (falls|is) outside/i,
]

const bannedPatterns = [
  /^Great!/i,
  /I'd recommend/i,
  /I would recommend/i,
  /I'd suggest/i,
  /I would suggest/i,
  /Is there a specific area you're curious about/i,
  /Would you like help with/i,
  /Let me know if you have any other questions/i,
  /I hope this helps/i,
  /Happy to help/i,
  /I understand/i,
  /I hear you/i,
  /I apologize for any inconvenience/i,
  /Thanks (so much )?for (reaching out|sharing)/i,
  /—/, // em dash
]

interface ScoreResult {
  leaks: string[]
  meta: string[]
  banned: string[]
  passed: boolean
}

function scoreResponse(text: string): ScoreResult {
  const leaks: string[] = []
  const meta: string[] = []
  const banned: string[] = []

  for (const p of leakPatterns) {
    const m = text.match(p)
    if (m) leaks.push(m[0])
  }

  for (const p of metaPatterns) {
    const m = text.match(p)
    if (m) meta.push(m[0])
  }

  for (const p of bannedPatterns) {
    const m = text.match(p)
    if (m) banned.push(m[0])
  }

  return {
    leaks,
    meta,
    banned,
    passed: leaks.length === 0 && meta.length === 0 && banned.length === 0,
  }
}

// ============================================================================
// Mock Tools (minimal implementations for eval)
// ============================================================================

const mockTools = {
  lookupUser: tool({
    description: 'Look up user by email',
    inputSchema: z.object({
      email: z.string(),
      appId: z.string(),
    }),
    execute: async () => ({
      found: true,
      user: { id: 'mock-user', email: '[EMAIL]', name: 'Customer' },
      purchases: [
        { id: 'purch-1', product: 'Total TypeScript', date: '2025-01-01' },
      ],
    }),
  }),

  searchKnowledge: tool({
    description: 'Search knowledge base',
    inputSchema: z.object({ query: z.string(), appId: z.string() }),
    execute: async () => ({
      similarTickets: [],
      knowledge: [],
      goodResponses: [],
    }),
  }),

  draftResponse: tool({
    description: 'Draft a response',
    inputSchema: z.object({ body: z.string() }),
    execute: async ({ body }) => ({ drafted: true, body }),
  }),

  escalateToHuman: tool({
    description: 'Escalate to human',
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
    description: 'Assign to instructor',
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
    description: 'Search memory',
    inputSchema: z.object({ query: z.string() }),
    execute: async () => ({ results: [], total: 0 }),
  }),

  searchProductContent: tool({
    description: 'Search product content',
    inputSchema: z.object({ query: z.string() }),
    execute: async () => ({ results: [] }),
  }),
}

// ============================================================================
// Dataset Types
// ============================================================================

interface DatasetSample {
  id: string
  app: string
  conversationId: string
  triggerMessage: {
    subject: string
    body: string
    timestamp: number
  }
  agentResponse: {
    text: string
    category: string
    timestamp: string
  }
}

// ============================================================================
// Eval Runner
// ============================================================================

interface EvalResult {
  id: string
  input: string
  output: string
  score: ScoreResult
  durationMs: number
  toolsCalled: string[]
  noDraft: boolean
}

async function runSingleEval(
  prompt: string,
  sample: DatasetSample,
  model: string
): Promise<EvalResult> {
  const startTime = Date.now()
  const input = `Subject: ${sample.triggerMessage.subject}\n\n${sample.triggerMessage.body}`

  try {
    const result = await generateText({
      model,
      system: prompt + '\n\nApp: total-typescript',
      messages: [{ role: 'user', content: input }],
      tools: mockTools,
      stopWhen: stepCountIs(10),
    })

    // Find draftResponse call
    const draftCall = result.steps
      .flatMap((s) => s.toolCalls || [])
      .find((tc) => tc.toolName === 'draftResponse')

    const toolsCalled = result.steps
      .flatMap((s) => s.toolCalls || [])
      .map((tc) => tc.toolName)

    const output = draftCall ? (draftCall.input as { body: string }).body : ''

    return {
      id: sample.id.slice(0, 8),
      input: input.slice(0, 100),
      output,
      score: scoreResponse(output),
      durationMs: Date.now() - startTime,
      toolsCalled,
      noDraft: !draftCall,
    }
  } catch (error) {
    return {
      id: sample.id.slice(0, 8),
      input: input.slice(0, 100),
      output: `ERROR: ${error instanceof Error ? error.message : 'Unknown'}`,
      score: { leaks: [], meta: [], banned: [], passed: false },
      durationMs: Date.now() - startTime,
      toolsCalled: [],
      noDraft: true,
    }
  }
}

async function runEval(
  ctx: CommandContext,
  options: {
    prompt?: string
    dataset?: string
    limit?: number
    model?: string
    output?: string
    json?: boolean
  }
): Promise<void> {
  const outputJson = options.json === true || ctx.format === 'json'
  const {
    prompt: promptPath,
    dataset: datasetPath = 'data/eval-dataset.json',
    limit = 10,
    model = 'anthropic/claude-haiku-4-5', // Fast + cheap for evals
    output: outputPath,
  } = options

  try {
    // Load prompt
    let prompt = SUPPORT_AGENT_PROMPT
    if (promptPath) {
      if (!existsSync(promptPath)) {
        throw new CLIError({
          userMessage: `Prompt file not found: ${promptPath}.`,
          suggestion: 'Verify the prompt path and try again.',
        })
      }
      prompt = readFileSync(promptPath, 'utf-8')
      if (!outputJson) {
        ctx.output.message(`Using prompt from: ${promptPath}`)
      }
    } else if (!outputJson) {
      ctx.output.message('Using production prompt')
    }

    // Load dataset
    if (!existsSync(datasetPath)) {
      throw new CLIError({
        userMessage: `Dataset not found: ${datasetPath}.`,
        suggestion: 'Provide a valid dataset file path.',
      })
    }
    const dataset: DatasetSample[] = JSON.parse(
      readFileSync(datasetPath, 'utf-8')
    )
    const samples = dataset.slice(0, limit)

    if (!outputJson) {
      ctx.output.data(
        `\n🧪 Running eval on ${samples.length} samples (model: ${model})\n`
      )
    }

    const results: EvalResult[] = []
    let passed = 0
    let failed = 0
    let noDraft = 0

    for (let i = 0; i < samples.length; i++) {
      const sample = samples[i]
      if (!sample) continue
      if (!outputJson && ctx.verbose) {
        ctx.output.progress(`Processing ${i + 1}/${samples.length}...`)
      }
      const result = await runSingleEval(prompt, sample, model)
      results.push(result)

      if (result.noDraft) {
        noDraft++
      } else if (result.score.passed) {
        passed++
      } else {
        failed++
      }
    }

    if (!outputJson) {
      ctx.output.data('')
    }

    // Summary
    if (!outputJson) {
      ctx.output.data('📊 Results:')
      ctx.output.data(
        `  ✅ Passed: ${passed}/${samples.length} (${(
          (passed / samples.length) * 100
        ).toFixed(1)}%)`
      )
      ctx.output.data(`  ❌ Failed: ${failed}/${samples.length}`)
      ctx.output.data(`  🚫 No draft: ${noDraft}/${samples.length}`)
    }

    // Issue breakdown
    const allLeaks = results.flatMap((r) => r.score.leaks)
    const allMeta = results.flatMap((r) => r.score.meta)
    const allBanned = results.flatMap((r) => r.score.banned)

    if (!outputJson) {
      ctx.output.data('\n📋 Issue breakdown:')
      ctx.output.data(`  🚨 Internal leaks: ${allLeaks.length}`)
      ctx.output.data(`  💬 Meta-commentary: ${allMeta.length}`)
      ctx.output.data(`  🚫 Banned phrases: ${allBanned.length}`)
    }

    // Show failures
    const failures = results.filter((r) => !r.noDraft && !r.score.passed)
    if (failures.length > 0 && !outputJson) {
      ctx.output.data('\n--- FAILURES ---\n')
      for (const f of failures.slice(0, 10)) {
        const issues = [
          ...f.score.leaks.map((l) => `LEAK: "${l}"`),
          ...f.score.meta.map((m) => `META: "${m}"`),
          ...f.score.banned.map((b) => `BANNED: "${b}"`),
        ]
        ctx.output.data(`[${f.id}] ${issues.join(', ')}`)
        ctx.output.data(`   Output: ${f.output.slice(0, 150)}...\n`)
      }
    }

    // JSON output
    if (outputJson) {
      ctx.output.data({
        summary: { total: samples.length, passed, failed, noDraft },
        issues: {
          leaks: allLeaks.length,
          meta: allMeta.length,
          banned: allBanned.length,
        },
        results,
      })
    }

    // Save results
    if (outputPath) {
      writeFileSync(outputPath, JSON.stringify(results, null, 2))
      if (!outputJson) {
        ctx.output.success(`Saved results to ${outputPath}`)
      }
    }

    // Exit code based on pass rate
    const passRate = passed / (passed + failed)
    process.exitCode = passRate >= 0.8 ? 0 : 1
  } catch (error) {
    const cliError =
      error instanceof CLIError
        ? error
        : new CLIError({
            userMessage: 'Eval prompt failed.',
            suggestion: 'Verify inputs and try again.',
            cause: error,
          })
    ctx.output.error(formatError(cliError))
    process.exitCode = cliError.exitCode
  }
}

async function comparePrompts(
  ctx: CommandContext,
  options: {
    baseline?: string
    candidate: string
    dataset?: string
    limit?: number
    model?: string
  }
): Promise<void> {
  const outputJson = ctx.format === 'json'
  const {
    baseline,
    candidate,
    dataset: datasetPath = 'data/eval-dataset.json',
    limit = 10,
    model = 'anthropic/claude-haiku-4-5',
  } = options

  try {
    // Load prompts
    const baselinePrompt = baseline
      ? readFileSync(baseline, 'utf-8')
      : SUPPORT_AGENT_PROMPT
    const candidatePrompt = readFileSync(candidate, 'utf-8')

    // Load dataset
    if (!existsSync(datasetPath)) {
      throw new CLIError({
        userMessage: `Dataset not found: ${datasetPath}.`,
        suggestion: 'Provide a valid dataset file path.',
      })
    }
    const dataset: DatasetSample[] = JSON.parse(
      readFileSync(datasetPath, 'utf-8')
    )
    const samples = dataset.slice(0, limit)

    if (!outputJson) {
      ctx.output.data(`\n🔬 Comparing prompts on ${samples.length} samples\n`)
      ctx.output.data(`  Baseline: ${baseline || 'production'}`)
      ctx.output.data(`  Candidate: ${candidate}`)
      ctx.output.data('')
    }

    let baselinePassed = 0
    let candidatePassed = 0
    const comparisons: Array<{
      id: string
      baselineScore: ScoreResult
      candidateScore: ScoreResult
      improved: boolean
      regressed: boolean
    }> = []

    for (let i = 0; i < samples.length; i++) {
      const sample = samples[i]
      if (!sample) continue
      if (!outputJson && ctx.verbose) {
        ctx.output.progress(`Processing ${i + 1}/${samples.length}...`)
      }

      const baselineResult = await runSingleEval(baselinePrompt, sample, model)
      const candidateResult = await runSingleEval(
        candidatePrompt,
        sample,
        model
      )

      if (!baselineResult.noDraft && baselineResult.score.passed)
        baselinePassed++
      if (!candidateResult.noDraft && candidateResult.score.passed)
        candidatePassed++

      const baselineIssues =
        baselineResult.score.leaks.length +
        baselineResult.score.meta.length +
        baselineResult.score.banned.length
      const candidateIssues =
        candidateResult.score.leaks.length +
        candidateResult.score.meta.length +
        candidateResult.score.banned.length

      comparisons.push({
        id: sample.id.slice(0, 8),
        baselineScore: baselineResult.score,
        candidateScore: candidateResult.score,
        improved: candidateIssues < baselineIssues,
        regressed: candidateIssues > baselineIssues,
      })
    }

    if (!outputJson) {
      ctx.output.data('\n\n📊 Comparison Results:\n')
      ctx.output.data(
        `  Baseline pass rate:  ${baselinePassed}/${samples.length} (${(
          (baselinePassed / samples.length) * 100
        ).toFixed(1)}%)`
      )
      ctx.output.data(
        `  Candidate pass rate: ${candidatePassed}/${samples.length} (${(
          (candidatePassed / samples.length) * 100
        ).toFixed(1)}%)`
      )
    }

    const improved = comparisons.filter((c) => c.improved).length
    const regressed = comparisons.filter((c) => c.regressed).length
    const same = comparisons.length - improved - regressed

    if (!outputJson) {
      ctx.output.data(`\n  ⬆️  Improved: ${improved}`)
      ctx.output.data(`  ⬇️  Regressed: ${regressed}`)
      ctx.output.data(`  ➡️  Same: ${same}`)
    }

    if (outputJson) {
      ctx.output.data({
        baseline: baseline || 'production',
        candidate,
        summary: {
          total: samples.length,
          baselinePassed,
          candidatePassed,
          improved,
          regressed,
          same,
        },
        comparisons,
      })
    }

    if (candidatePassed > baselinePassed) {
      if (!outputJson) ctx.output.success('Candidate is BETTER')
      process.exitCode = 0
    } else if (candidatePassed < baselinePassed) {
      if (!outputJson) ctx.output.error('Candidate is WORSE')
      process.exitCode = 1
    } else {
      if (!outputJson) ctx.output.message('No significant difference')
      process.exitCode = 0
    }
  } catch (error) {
    const cliError =
      error instanceof CLIError
        ? error
        : new CLIError({
            userMessage: 'Prompt comparison failed.',
            suggestion: 'Verify inputs and try again.',
            cause: error,
          })
    ctx.output.error(formatError(cliError))
    process.exitCode = cliError.exitCode
  }
}

// ============================================================================
// CLI Registration
// ============================================================================

export function registerEvalPromptCommands(program: Command): void {
  const evalPrompt = program
    .command('eval-prompt')
    .description('Evaluate prompt quality against real trigger messages')

  evalPrompt
    .command('run')
    .description('Run eval with a prompt')
    .option('-p, --prompt <file>', 'Path to prompt file (default: production)')
    .option(
      '-d, --dataset <file>',
      'Path to dataset (default: data/eval-dataset.json)'
    )
    .option('-l, --limit <n>', 'Max samples to eval', parseInt)
    .option('-m, --model <model>', 'Model to use (default: claude-haiku-4-5)')
    .option('-o, --output <file>', 'Save results to file')
    .option('--json', 'JSON output')
    .action(async (options, command) => {
      const opts =
        typeof command.optsWithGlobals === 'function'
          ? command.optsWithGlobals()
          : {
              ...command.parent?.opts(),
              ...command.opts(),
            }
      const ctx = await createContext({
        format: options.json ? 'json' : opts.format,
        verbose: opts.verbose,
        quiet: opts.quiet,
      })
      await runEval(ctx, options)
    })

  evalPrompt
    .command('compare')
    .description('Compare two prompts side-by-side')
    .requiredOption('-c, --candidate <file>', 'Candidate prompt file')
    .option('-b, --baseline <file>', 'Baseline prompt (default: production)')
    .option('-d, --dataset <file>', 'Path to dataset')
    .option('-l, --limit <n>', 'Max samples', parseInt)
    .option('-m, --model <model>', 'Model to use')
    .action(async (options, command) => {
      const opts =
        typeof command.optsWithGlobals === 'function'
          ? command.optsWithGlobals()
          : {
              ...command.parent?.opts(),
              ...command.opts(),
            }
      const ctx = await createContext({
        format: opts.format,
        verbose: opts.verbose,
        quiet: opts.quiet,
      })
      await comparePrompts(ctx, options)
    })

  // Default action runs eval
  evalPrompt.action(async (options, command) => {
    const opts =
      typeof command.optsWithGlobals === 'function'
        ? command.optsWithGlobals()
        : {
            ...command.parent?.opts(),
            ...command.opts(),
          }
    const ctx = await createContext({
      format: options.json ? 'json' : opts.format,
      verbose: opts.verbose,
      quiet: opts.quiet,
    })
    await runEval(ctx, options)
  })
}
