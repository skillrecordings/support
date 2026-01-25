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

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import type { Command } from 'commander'
import { generateText, stepCountIs, tool } from 'ai'
import { z } from 'zod'

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
      user: { id: 'mock-user', email: 'customer@example.com', name: 'Customer' },
      purchases: [{ id: 'purch-1', product: 'Total TypeScript', date: '2025-01-01' }],
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
    execute: async ({ reason, urgency }) => ({ escalated: true, reason, urgency }),
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
    const draftCall = result.steps.flatMap(s => s.toolCalls || [])
      .find(tc => tc.toolName === 'draftResponse')

    const toolsCalled = result.steps.flatMap(s => s.toolCalls || [])
      .map(tc => tc.toolName)

    const output = draftCall 
      ? (draftCall.input as { body: string }).body 
      : ''

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

async function runEval(options: {
  prompt?: string
  dataset?: string
  limit?: number
  model?: string
  output?: string
  json?: boolean
}): Promise<void> {
  const {
    prompt: promptPath,
    dataset: datasetPath = 'data/eval-dataset.json',
    limit = 10,
    model = 'anthropic/claude-haiku-4-5', // Fast + cheap for evals
    output: outputPath,
    json = false,
  } = options

  // Load prompt
  let prompt = SUPPORT_AGENT_PROMPT
  if (promptPath) {
    if (!existsSync(promptPath)) {
      console.error(`Prompt file not found: ${promptPath}`)
      process.exit(1)
    }
    prompt = readFileSync(promptPath, 'utf-8')
    console.log(`Using prompt from: ${promptPath}`)
  } else {
    console.log('Using production prompt')
  }

  // Load dataset
  if (!existsSync(datasetPath)) {
    console.error(`Dataset not found: ${datasetPath}`)
    process.exit(1)
  }
  const dataset: DatasetSample[] = JSON.parse(readFileSync(datasetPath, 'utf-8'))
  const samples = dataset.slice(0, limit)

  console.log(`\n🧪 Running eval on ${samples.length} samples (model: ${model})\n`)

  const results: EvalResult[] = []
  let passed = 0
  let failed = 0
  let noDraft = 0

  for (let i = 0; i < samples.length; i++) {
    process.stdout.write(`\r  Processing ${i + 1}/${samples.length}...`)
    const sample = samples[i]
    if (!sample) continue
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

  console.log('\n')

  // Summary
  console.log('📊 Results:')
  console.log(`  ✅ Passed: ${passed}/${samples.length} (${((passed/samples.length)*100).toFixed(1)}%)`)
  console.log(`  ❌ Failed: ${failed}/${samples.length}`)
  console.log(`  🚫 No draft: ${noDraft}/${samples.length}`)

  // Issue breakdown
  const allLeaks = results.flatMap(r => r.score.leaks)
  const allMeta = results.flatMap(r => r.score.meta)
  const allBanned = results.flatMap(r => r.score.banned)

  console.log('\n📋 Issue breakdown:')
  console.log(`  🚨 Internal leaks: ${allLeaks.length}`)
  console.log(`  💬 Meta-commentary: ${allMeta.length}`)
  console.log(`  🚫 Banned phrases: ${allBanned.length}`)

  // Show failures
  const failures = results.filter(r => !r.noDraft && !r.score.passed)
  if (failures.length > 0 && !json) {
    console.log('\n--- FAILURES ---\n')
    for (const f of failures.slice(0, 10)) {
      const issues = [
        ...f.score.leaks.map(l => `LEAK: "${l}"`),
        ...f.score.meta.map(m => `META: "${m}"`),
        ...f.score.banned.map(b => `BANNED: "${b}"`),
      ]
      console.log(`[${f.id}] ${issues.join(', ')}`)
      console.log(`   Output: ${f.output.slice(0, 150)}...\n`)
    }
  }

  // JSON output
  if (json) {
    console.log(JSON.stringify({
      summary: { total: samples.length, passed, failed, noDraft },
      issues: { leaks: allLeaks.length, meta: allMeta.length, banned: allBanned.length },
      results,
    }, null, 2))
  }

  // Save results
  if (outputPath) {
    writeFileSync(outputPath, JSON.stringify(results, null, 2))
    console.log(`\nSaved results to ${outputPath}`)
  }

  // Exit code based on pass rate
  const passRate = passed / (passed + failed)
  process.exit(passRate >= 0.8 ? 0 : 1)
}

async function comparePrompts(options: {
  baseline?: string
  candidate: string
  dataset?: string
  limit?: number
  model?: string
}): Promise<void> {
  const {
    baseline,
    candidate,
    dataset: datasetPath = 'data/eval-dataset.json',
    limit = 10,
    model = 'anthropic/claude-haiku-4-5',
  } = options

  // Load prompts
  const baselinePrompt = baseline 
    ? readFileSync(baseline, 'utf-8')
    : SUPPORT_AGENT_PROMPT
  const candidatePrompt = readFileSync(candidate, 'utf-8')

  // Load dataset
  const dataset: DatasetSample[] = JSON.parse(readFileSync(datasetPath, 'utf-8'))
  const samples = dataset.slice(0, limit)

  console.log(`\n🔬 Comparing prompts on ${samples.length} samples\n`)
  console.log(`  Baseline: ${baseline || 'production'}`)
  console.log(`  Candidate: ${candidate}`)
  console.log('')

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
    process.stdout.write(`\r  Processing ${i + 1}/${samples.length}...`)

    const baselineResult = await runSingleEval(baselinePrompt, sample, model)
    const candidateResult = await runSingleEval(candidatePrompt, sample, model)

    if (!baselineResult.noDraft && baselineResult.score.passed) baselinePassed++
    if (!candidateResult.noDraft && candidateResult.score.passed) candidatePassed++

    const baselineIssues = baselineResult.score.leaks.length + baselineResult.score.meta.length + baselineResult.score.banned.length
    const candidateIssues = candidateResult.score.leaks.length + candidateResult.score.meta.length + candidateResult.score.banned.length

    comparisons.push({
      id: sample.id.slice(0, 8),
      baselineScore: baselineResult.score,
      candidateScore: candidateResult.score,
      improved: candidateIssues < baselineIssues,
      regressed: candidateIssues > baselineIssues,
    })
  }

  console.log('\n\n📊 Comparison Results:\n')
  console.log(`  Baseline pass rate:  ${baselinePassed}/${samples.length} (${((baselinePassed/samples.length)*100).toFixed(1)}%)`)
  console.log(`  Candidate pass rate: ${candidatePassed}/${samples.length} (${((candidatePassed/samples.length)*100).toFixed(1)}%)`)

  const improved = comparisons.filter(c => c.improved).length
  const regressed = comparisons.filter(c => c.regressed).length
  const same = comparisons.length - improved - regressed

  console.log(`\n  ⬆️  Improved: ${improved}`)
  console.log(`  ⬇️  Regressed: ${regressed}`)
  console.log(`  ➡️  Same: ${same}`)

  if (candidatePassed > baselinePassed) {
    console.log('\n✅ Candidate is BETTER')
    process.exit(0)
  } else if (candidatePassed < baselinePassed) {
    console.log('\n❌ Candidate is WORSE')
    process.exit(1)
  } else {
    console.log('\n➡️  No significant difference')
    process.exit(0)
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
    .option('-d, --dataset <file>', 'Path to dataset (default: data/eval-dataset.json)')
    .option('-l, --limit <n>', 'Max samples to eval', parseInt)
    .option('-m, --model <model>', 'Model to use (default: claude-haiku-4-5)')
    .option('-o, --output <file>', 'Save results to file')
    .option('--json', 'JSON output')
    .action(runEval)

  evalPrompt
    .command('compare')
    .description('Compare two prompts side-by-side')
    .requiredOption('-c, --candidate <file>', 'Candidate prompt file')
    .option('-b, --baseline <file>', 'Baseline prompt (default: production)')
    .option('-d, --dataset <file>', 'Path to dataset')
    .option('-l, --limit <n>', 'Max samples', parseInt)
    .option('-m, --model <model>', 'Model to use')
    .action(comparePrompts)

  // Default action runs eval
  evalPrompt.action(runEval)
}
