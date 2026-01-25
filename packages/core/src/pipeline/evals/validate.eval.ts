/**
 * Validate step evaluation
 *
 * Tests that the validator catches known issues.
 */

import { readFile, writeFile } from 'fs/promises'
import { formatIssues, validate } from '../steps/validate'
import type {
  EvalSummary,
  GatherOutput,
  ValidateInput,
  ValidateOutput,
  ValidationIssueType,
} from '../types'

// ============================================================================
// Types
// ============================================================================

interface ValidateEvalScenario {
  id: string
  name: string
  draft: string
  expectedIssues: ValidationIssueType[]
  shouldPass: boolean
  tags?: string[]
}

interface ValidateEvalResult {
  scenarioId: string
  passed: boolean
  expectedIssues: ValidationIssueType[]
  actualIssues: ValidationIssueType[]
  missingIssues: ValidationIssueType[]
  extraIssues: ValidationIssueType[]
  durationMs: number
}

// ============================================================================
// Test scenarios (built-in)
// ============================================================================

const BUILT_IN_SCENARIOS: ValidateEvalScenario[] = [
  // Internal leaks
  {
    id: 'leak-no-instructor',
    name: 'Leaks no instructor configured',
    draft:
      "I'd route this to Matt but there's no instructor routing configured for this app.",
    expectedIssues: ['internal_leak'],
    shouldPass: false,
    tags: ['internal_leak'],
  },
  {
    id: 'leak-cant-route',
    name: 'Leaks routing failure',
    draft:
      "This should be routed to the instructor but I can't route it right now.",
    expectedIssues: ['internal_leak'],
    shouldPass: false,
    tags: ['internal_leak'],
  },
  {
    id: 'leak-api-error',
    name: 'Leaks API error',
    draft:
      'I tried to look up your account but got an API error. Please try again.',
    expectedIssues: ['internal_leak'],
    shouldPass: false,
    tags: ['internal_leak'],
  },
  {
    id: 'leak-outside-scope',
    name: 'Leaks scope limitation',
    draft: 'This falls outside the scope of what I can help with.',
    expectedIssues: ['internal_leak'],
    shouldPass: false,
    tags: ['internal_leak'],
  },

  // Meta-commentary
  {
    id: 'meta-this-is-a',
    name: 'Meta: This is a vendor email',
    draft: 'This is a vendor email, not a support request.',
    expectedIssues: ['meta_commentary'],
    shouldPass: false,
    tags: ['meta_commentary'],
  },
  {
    id: 'meta-wont-respond',
    name: "Meta: I won't respond",
    draft: "I won't respond to this as it's not a customer inquiry.",
    expectedIssues: ['meta_commentary'],
    shouldPass: false,
    tags: ['meta_commentary'],
  },
  {
    id: 'meta-per-guidelines',
    name: 'Meta: Per my guidelines',
    draft: 'Per my guidelines, I should not respond to partnership requests.',
    expectedIssues: ['meta_commentary'],
    shouldPass: false,
    tags: ['meta_commentary'],
  },

  // Banned phrases
  {
    id: 'banned-great',
    name: 'Banned: Great!',
    draft: "Great! I'd be happy to help you with that.",
    expectedIssues: ['banned_phrase'],
    shouldPass: false,
    tags: ['banned_phrase'],
  },
  {
    id: 'banned-id-recommend',
    name: "Banned: I'd recommend",
    draft: "I'd recommend starting with the basics tutorial.",
    expectedIssues: ['banned_phrase'],
    shouldPass: false,
    tags: ['banned_phrase'],
  },
  {
    id: 'banned-em-dash',
    name: 'Banned: Em dash',
    draft:
      'Your purchase — which was made last week — is eligible for a refund.',
    expectedIssues: ['banned_phrase'],
    shouldPass: false,
    tags: ['banned_phrase'],
  },
  {
    id: 'banned-thanks-reaching-out',
    name: 'Banned: Thanks for reaching out',
    draft: 'Thanks for reaching out! Let me look into this for you.',
    expectedIssues: ['banned_phrase'],
    shouldPass: false,
    tags: ['banned_phrase'],
  },

  // Good responses (should pass)
  {
    id: 'good-refund',
    name: 'Good refund response',
    draft: "Refund processed. You'll see it in 3-5 business days.",
    expectedIssues: [],
    shouldPass: true,
    tags: ['good'],
  },
  {
    id: 'good-access',
    name: 'Good access response',
    draft: 'Sent a magic link to your email. Click it to log in.',
    expectedIssues: [],
    shouldPass: true,
    tags: ['good'],
  },
  {
    id: 'good-question',
    name: 'Good clarifying question',
    draft: 'What email did you use when you purchased?',
    expectedIssues: [],
    shouldPass: true,
    tags: ['good'],
  },

  // Multiple issues
  {
    id: 'multi-leak-and-banned',
    name: 'Multiple: leak + banned phrase',
    draft:
      "Great! I'd be happy to help, but this should be routed to the instructor.",
    expectedIssues: ['banned_phrase', 'internal_leak'],
    shouldPass: false,
    tags: ['multi'],
  },
]

// ============================================================================
// Run eval
// ============================================================================

export interface ValidateEvalOptions {
  dataset?: string // Path to JSON file, or use built-in
  output?: string
  verbose?: boolean
  json?: boolean
}

export async function runValidateEval(
  options: ValidateEvalOptions
): Promise<EvalSummary> {
  const { dataset, output, verbose, json } = options

  let scenarios: ValidateEvalScenario[]
  if (dataset) {
    const content = await readFile(dataset, 'utf-8')
    scenarios = JSON.parse(content)
  } else {
    scenarios = BUILT_IN_SCENARIOS
  }

  if (!json) {
    console.log(`\n✅ Running validate eval on ${scenarios.length} scenarios\n`)
  }

  const results: ValidateEvalResult[] = []
  const startTime = Date.now()

  // Empty context for testing (fabrication checks need context)
  const emptyContext: GatherOutput = {
    user: null,
    purchases: [],
    knowledge: [],
    history: [],
    priorMemory: [],
    gatherErrors: [],
  }

  for (const scenario of scenarios) {
    const scenarioStart = Date.now()

    const result = validate({ draft: scenario.draft, context: emptyContext })
    const actualIssues = [...new Set(result.issues.map((i) => i.type))]

    const missingIssues = scenario.expectedIssues.filter(
      (e) => !actualIssues.includes(e)
    )
    const extraIssues = actualIssues.filter(
      (a) => !scenario.expectedIssues.includes(a)
    )

    // Pass if: expected issues found AND no unexpected issues
    const passed = missingIssues.length === 0 && extraIssues.length === 0

    results.push({
      scenarioId: scenario.id,
      passed,
      expectedIssues: scenario.expectedIssues,
      actualIssues,
      missingIssues,
      extraIssues,
      durationMs: Date.now() - scenarioStart,
    })

    if (verbose && !passed) {
      console.log(`❌ ${scenario.name}`)
      if (missingIssues.length > 0) {
        console.log(`   Missing: ${missingIssues.join(', ')}`)
      }
      if (extraIssues.length > 0) {
        console.log(`   Extra:   ${extraIssues.join(', ')}`)
      }
      console.log(`   Draft:   "${scenario.draft.slice(0, 60)}..."`)
    }
  }

  const totalDuration = Date.now() - startTime
  const passedCount = results.filter((r) => r.passed).length
  const failedCount = results.length - passedCount
  const passRate = results.length > 0 ? passedCount / results.length : 0

  // Group by tag
  const byTag: Record<string, { passed: number; failed: number }> = {}
  for (let i = 0; i < scenarios.length; i++) {
    const scenario = scenarios[i]
    const result = results[i]
    if (!scenario || !result) continue
    for (const tag of scenario.tags || ['untagged']) {
      if (!byTag[tag]) byTag[tag] = { passed: 0, failed: 0 }
      if (result.passed) byTag[tag].passed++
      else byTag[tag].failed++
    }
  }

  const summary: EvalSummary = {
    total: results.length,
    passed: passedCount,
    failed: failedCount,
    passRate,
    durationMs: totalDuration,
    byTag,
  }

  if (output) {
    await writeFile(output, JSON.stringify({ summary, results }, null, 2))
    if (!json) console.log(`Results saved to ${output}`)
  }

  if (json) {
    console.log(JSON.stringify({ summary, results }, null, 2))
  } else {
    console.log('✅ Validate Eval Results\n')
    console.log(`Total: ${summary.total}`)
    console.log(
      `  ✅ Passed: ${summary.passed} (${(summary.passRate * 100).toFixed(1)}%)`
    )
    console.log(`  ❌ Failed: ${summary.failed}`)

    if (Object.keys(byTag).length > 1) {
      console.log('\nBy Issue Type:')
      for (const [tag, counts] of Object.entries(byTag)) {
        const total = counts.passed + counts.failed
        const rate = ((counts.passed / total) * 100).toFixed(0)
        console.log(`  ${tag}: ${counts.passed}/${total} (${rate}%)`)
      }
    }

    console.log(
      `\nLatency: ${(totalDuration / results.length).toFixed(2)}ms avg`
    )
  }

  return summary
}

// ============================================================================
// Build dataset from production failures
// ============================================================================

export async function buildValidateDatasetFromProduction(
  productionResultsPath: string,
  outputPath: string
): Promise<void> {
  const content = await readFile(productionResultsPath, 'utf-8')
  const production = JSON.parse(content)

  const scenarios: ValidateEvalScenario[] = production.results
    .filter((r: any) => !r.passed && r.productionResponse)
    .map((r: any, i: number) => ({
      id: `prod-fail-${i}`,
      name: r.subject?.slice(0, 50) || `Failure ${i}`,
      draft: r.productionResponse,
      expectedIssues: r.failureReasons
        .map((reason: string) => {
          if (reason.includes('Internal leak')) return 'internal_leak'
          if (reason.includes('Meta commentary')) return 'meta_commentary'
          if (reason.includes('Banned phrase')) return 'banned_phrase'
          if (reason.includes('Fabrication')) return 'fabrication'
          return null
        })
        .filter(Boolean),
      shouldPass: false,
      tags: ['production_failure'],
    }))

  await writeFile(outputPath, JSON.stringify(scenarios, null, 2))
  console.log(
    `Built ${scenarios.length} scenarios from production failures → ${outputPath}`
  )
}
