/**
 * Score REAL production responses from the dataset
 *
 * No mocks, no generation - just score what was actually sent to customers.
 * This gives us the TRUE baseline quality of production.
 */

import {
  BannedPhrases,
  Helpfulness,
  InternalStateLeakage,
  MetaCommentary,
  ProductFabrication,
} from '@skillrecordings/core/evals/scorers'
import { readFile, writeFile } from 'fs/promises'
import { type CommandContext } from '../../core/context'

interface DatasetItem {
  id: string
  app: string
  conversationId: string
  customerEmail: string
  triggerMessage: {
    subject: string
    body: string
    timestamp: number
  }
  agentResponse?: {
    text: string
    category: string
    timestamp: string
  }
  conversationHistory: Array<{
    direction: 'in' | 'out'
    body: string
    timestamp: number
  }>
}

interface ScoreResult {
  id: string
  subject: string
  hadResponse: boolean
  productionResponse: string
  scores: {
    internalLeaks: { passed: boolean; matches: string[] }
    metaCommentary: { passed: boolean; matches: string[] }
    bannedPhrases: { passed: boolean; matches: string[] }
    fabrication: { passed: boolean; matches: string[] }
    helpfulness: { score: number }
  }
  passed: boolean
  failureReasons: string[]
}

interface ScoreOptions {
  dataset: string
  output?: string
  verbose?: boolean
  json?: boolean
}

export async function scoreProduction(
  ctx: CommandContext,
  options: ScoreOptions
): Promise<void> {
  const { dataset: datasetPath, output, verbose, json } = options
  const outputJson = json === true || ctx.format === 'json'
  const log = (text: string): void => {
    if (!outputJson) ctx.output.data(text)
  }

  const datasetContent = await readFile(datasetPath, 'utf-8')
  const dataset: DatasetItem[] = JSON.parse(datasetContent)

  log(`\n📊 Scoring ${dataset.length} production responses\n`)

  const results: ScoreResult[] = []
  let passed = 0
  let failed = 0
  let noResponse = 0

  const failures = {
    internalLeaks: 0,
    metaCommentary: 0,
    bannedPhrases: 0,
    fabrication: 0,
  }

  for (const item of dataset) {
    const response = item.agentResponse?.text || ''
    const subject = item.triggerMessage?.subject || 'Unknown'

    if (!response || response.trim().length === 0) {
      noResponse++
      results.push({
        id: item.id,
        subject,
        hadResponse: false,
        productionResponse: '',
        scores: {
          internalLeaks: { passed: true, matches: [] },
          metaCommentary: { passed: true, matches: [] },
          bannedPhrases: { passed: true, matches: [] },
          fabrication: { passed: true, matches: [] },
          helpfulness: { score: 0 },
        },
        passed: true, // No response = can't fail quality
        failureReasons: [],
      })
      continue
    }

    // Score the production response
    const leakResult = InternalStateLeakage({ output: response })
    const metaResult = MetaCommentary({ output: response })
    const bannedResult = BannedPhrases({ output: response })
    const fabResult = ProductFabrication({ output: response })
    const helpResult = Helpfulness({ output: response })

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

    const failureReasons: string[] = []
    if (!scores.internalLeaks.passed) {
      failureReasons.push(
        `Internal leak: ${scores.internalLeaks.matches.join(', ')}`
      )
      failures.internalLeaks++
    }
    if (!scores.metaCommentary.passed) {
      failureReasons.push(
        `Meta commentary: ${scores.metaCommentary.matches.join(', ')}`
      )
      failures.metaCommentary++
    }
    if (!scores.bannedPhrases.passed) {
      failureReasons.push(
        `Banned phrase: ${scores.bannedPhrases.matches.join(', ')}`
      )
      failures.bannedPhrases++
    }
    if (!scores.fabrication.passed) {
      failureReasons.push(
        `Fabrication: ${scores.fabrication.matches.join(', ')}`
      )
      failures.fabrication++
    }

    const itemPassed = failureReasons.length === 0
    if (itemPassed) {
      passed++
    } else {
      failed++
    }

    results.push({
      id: item.id,
      subject,
      hadResponse: true,
      productionResponse: response,
      scores,
      passed: itemPassed,
      failureReasons,
    })

    if (verbose && !itemPassed) {
      log(`❌ ${subject.slice(0, 60)}...`)
      for (const reason of failureReasons) {
        log(`   └─ ${reason}`)
      }
    }
  }

  // Summary
  const withResponses = passed + failed
  const passRate = withResponses > 0 ? (passed / withResponses) * 100 : 0

  if (output) {
    await writeFile(
      output,
      JSON.stringify(
        {
          summary: {
            total: dataset.length,
            withResponses,
            noResponse,
            passed,
            failed,
            passRate,
            failures,
          },
          results,
        },
        null,
        2
      )
    )
    log(`Results saved to ${output}`)
  }

  if (outputJson) {
    ctx.output.data({
      summary: {
        total: dataset.length,
        withResponses,
        noResponse,
        passed,
        failed,
        passRate,
        failures,
      },
      results,
    })
    return
  }

  ctx.output.data('📊 Production Response Quality\n')
  ctx.output.data(`Total conversations: ${dataset.length}`)
  ctx.output.data(`  With response:   ${withResponses}`)
  ctx.output.data(`  No response:     ${noResponse}`)
  ctx.output.data('')
  ctx.output.data(`Quality (responses only):`)
  ctx.output.data(`  ✅ Passed: ${passed} (${passRate.toFixed(1)}%)`)
  ctx.output.data(`  ❌ Failed: ${failed}`)

  if (failed > 0) {
    ctx.output.data('\nFailure breakdown:')
    if (failures.internalLeaks > 0)
      ctx.output.data(`  🚨 Internal leaks:    ${failures.internalLeaks}`)
    if (failures.metaCommentary > 0)
      ctx.output.data(`  💬 Meta-commentary:   ${failures.metaCommentary}`)
    if (failures.bannedPhrases > 0)
      ctx.output.data(`  🚫 Banned phrases:    ${failures.bannedPhrases}`)
    if (failures.fabrication > 0)
      ctx.output.data(`  🎭 Fabrication:       ${failures.fabrication}`)
  }
}
