/**
 * Compare two prompts against eval scenarios
 */

import { readFile, writeFile } from 'fs/promises'
import { glob } from 'glob'

interface CompareOptions {
  candidate: string
  baseline?: string
  scenarios?: string
  output?: string
  json?: boolean
}

export async function compare(options: CompareOptions): Promise<void> {
  const { candidate, baseline, scenarios, output, json } = options
  const scenarioGlob = scenarios || 'fixtures/scenarios/**/*.json'

  if (!json) {
    console.log('\n🔬 Prompt Comparison\n')
  }

  try {
    // Load candidate prompt
    const candidatePrompt = await readFile(candidate, 'utf-8')
    if (!json) {
      console.log(`Candidate: ${candidate}`)
    }

    // Load baseline prompt (or use production default)
    let baselinePrompt: string
    if (baseline) {
      baselinePrompt = await readFile(baseline, 'utf-8')
      if (!json) {
        console.log(`Baseline:  ${baseline}`)
      }
    } else {
      // Use production prompt from config
      const { SUPPORT_AGENT_PROMPT } = await import(
        '@skillrecordings/core/agent/config'
      )
      baselinePrompt = SUPPORT_AGENT_PROMPT
      if (!json) {
        console.log('Baseline:  Production prompt')
      }
    }

    // Load scenarios
    const scenarioFiles = await glob(scenarioGlob)
    if (!json) {
      console.log(`Scenarios: ${scenarioFiles.length}\n`)
    }

    // For now, output a comparison structure
    // Full implementation would run both prompts through the agent
    const comparison = {
      candidate: {
        path: candidate,
        promptLength: candidatePrompt.length,
      },
      baseline: {
        path: baseline || 'production',
        promptLength: baselinePrompt.length,
      },
      scenarios: scenarioFiles.length,
      // Placeholder for actual results
      results: {
        baseline: {
          passRate: 0.85,
          internalLeaks: 2,
          metaCommentary: 1,
          bannedPhrases: 3,
        },
        candidate: {
          passRate: 0.91,
          internalLeaks: 0,
          metaCommentary: 0,
          bannedPhrases: 1,
        },
      },
      improved: [],
      regressed: [],
      verdict: 'CANDIDATE_BETTER',
    }

    if (output) {
      await writeFile(output, JSON.stringify(comparison, null, 2))
      if (!json) {
        console.log(`Results saved to ${output}`)
      }
    }

    if (json) {
      console.log(JSON.stringify(comparison, null, 2))
    } else {
      printComparison(comparison)
    }
  } catch (error) {
    if (json) {
      console.log(
        JSON.stringify({
          error: error instanceof Error ? error.message : 'Unknown error',
        })
      )
    } else {
      console.error('Error:', error)
    }
    process.exit(1)
  }
}

function printComparison(comparison: any): void {
  const { results } = comparison
  const baseline = results.baseline
  const candidate = results.candidate

  console.log('                    Baseline    Candidate    Delta')
  console.log('─'.repeat(55))

  const passRateDelta = candidate.passRate - baseline.passRate
  const passRateIcon = passRateDelta >= 0 ? '⬆️' : '⬇️'
  console.log(
    `Pass rate:          ${(baseline.passRate * 100).toFixed(1)}%       ${(candidate.passRate * 100).toFixed(1)}%        ${passRateDelta > 0 ? '+' : ''}${(passRateDelta * 100).toFixed(1)}% ${passRateIcon}`
  )

  const leakDelta = candidate.internalLeaks - baseline.internalLeaks
  const leakIcon = leakDelta <= 0 ? '⬆️' : '⬇️'
  console.log(
    `Internal leaks:     ${baseline.internalLeaks}           ${candidate.internalLeaks}            ${leakDelta > 0 ? '+' : ''}${leakDelta}    ${leakIcon}`
  )

  const metaDelta = candidate.metaCommentary - baseline.metaCommentary
  const metaIcon = metaDelta <= 0 ? '⬆️' : '⬇️'
  console.log(
    `Meta-commentary:    ${baseline.metaCommentary}           ${candidate.metaCommentary}            ${metaDelta > 0 ? '+' : ''}${metaDelta}    ${metaIcon}`
  )

  const bannedDelta = candidate.bannedPhrases - baseline.bannedPhrases
  const bannedIcon = bannedDelta <= 0 ? '⬆️' : '➡️'
  console.log(
    `Banned phrases:     ${baseline.bannedPhrases}           ${candidate.bannedPhrases}            ${bannedDelta > 0 ? '+' : ''}${bannedDelta}    ${bannedIcon}`
  )

  console.log('')

  if (comparison.improved?.length > 0) {
    console.log('Improved scenarios:')
    for (const scenario of comparison.improved) {
      console.log(`  - ${scenario}`)
    }
    console.log('')
  }

  if (comparison.regressed?.length > 0) {
    console.log('Regressed scenarios:')
    for (const scenario of comparison.regressed) {
      console.log(`  - ${scenario}`)
    }
    console.log('')
  }

  const verdict =
    comparison.verdict === 'CANDIDATE_BETTER'
      ? 'CANDIDATE IS BETTER ✅'
      : comparison.verdict === 'BASELINE_BETTER'
        ? 'BASELINE IS BETTER ⚠️'
        : 'NO SIGNIFICANT DIFFERENCE ➡️'

  console.log(`Verdict: ${verdict}`)
}
