/**
 * Classify step evaluation
 *
 * Tests classifier accuracy against labeled dataset.
 */

import { readFile, writeFile } from 'fs/promises'
import { classify, extractSignals, fastClassify } from '../steps/classify'
import type {
  ClassifyInput,
  ClassifyOutput,
  EvalSummary,
  MessageCategory,
} from '../types'

// ============================================================================
// Types
// ============================================================================

interface ClassifyEvalScenario {
  id: string
  input: ClassifyInput
  expected: {
    category: MessageCategory
    minConfidence?: number
  }
  tags?: string[]
}

interface ClassifyEvalResult {
  scenarioId: string
  passed: boolean
  expected: MessageCategory
  actual: MessageCategory
  confidence: number
  usedFastPath: boolean
  durationMs: number
  reasoning?: string
}

// ============================================================================
// Run eval
// ============================================================================

export interface ClassifyEvalOptions {
  dataset: string // Path to JSON file with scenarios
  output?: string
  verbose?: boolean
  json?: boolean
  forceLLM?: boolean // Skip fast path
  model?: string
}

export async function runClassifyEval(
  options: ClassifyEvalOptions
): Promise<EvalSummary> {
  const { dataset, output, verbose, json, forceLLM, model } = options

  const datasetContent = await readFile(dataset, 'utf-8')
  const scenarios: ClassifyEvalScenario[] = JSON.parse(datasetContent)

  if (!json) {
    console.log(`\n🏷️  Running classify eval on ${scenarios.length} scenarios\n`)
  }

  const results: ClassifyEvalResult[] = []
  const startTime = Date.now()

  for (const scenario of scenarios) {
    const scenarioStart = Date.now()

    // Check if fast path would handle it
    const signals = extractSignals(scenario.input)
    const fastResult = fastClassify(scenario.input, signals)
    const usedFastPath = fastResult !== null && !forceLLM

    // Run classification
    const result = await classify(scenario.input, { forceLLM, model })

    const passed =
      result.category === scenario.expected.category &&
      (scenario.expected.minConfidence === undefined ||
        result.confidence >= scenario.expected.minConfidence)

    results.push({
      scenarioId: scenario.id,
      passed,
      expected: scenario.expected.category,
      actual: result.category,
      confidence: result.confidence,
      usedFastPath,
      durationMs: Date.now() - scenarioStart,
      reasoning: result.reasoning,
    })

    if (verbose && !passed) {
      console.log(`❌ ${scenario.id}`)
      console.log(`   Expected: ${scenario.expected.category}`)
      console.log(
        `   Actual:   ${result.category} (${(result.confidence * 100).toFixed(0)}%)`
      )
      console.log(`   Subject:  ${scenario.input.subject.slice(0, 50)}...`)
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

  // Confusion matrix
  const confusion: Record<string, Record<string, number>> = {}
  for (const r of results) {
    if (!confusion[r.expected]) confusion[r.expected] = {}
    const row = confusion[r.expected]!
    row[r.actual] = (row[r.actual] || 0) + 1
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
    await writeFile(
      output,
      JSON.stringify({ summary, results, confusion }, null, 2)
    )
    if (!json) console.log(`Results saved to ${output}`)
  }

  if (json) {
    console.log(JSON.stringify({ summary, results, confusion }, null, 2))
  } else {
    console.log('🏷️  Classify Eval Results\n')
    console.log(`Total: ${summary.total}`)
    console.log(
      `  ✅ Passed: ${summary.passed} (${(summary.passRate * 100).toFixed(1)}%)`
    )
    console.log(`  ❌ Failed: ${summary.failed}`)

    const fastPathCount = results.filter((r) => r.usedFastPath).length
    console.log(
      `\nFast path: ${fastPathCount}/${results.length} (${((fastPathCount / results.length) * 100).toFixed(0)}%)`
    )

    if (Object.keys(byTag).length > 1) {
      console.log('\nBy Tag:')
      for (const [tag, counts] of Object.entries(byTag)) {
        const total = counts.passed + counts.failed
        const rate = ((counts.passed / total) * 100).toFixed(0)
        console.log(`  ${tag}: ${counts.passed}/${total} (${rate}%)`)
      }
    }

    console.log(
      `\nLatency: ${(totalDuration / results.length).toFixed(0)}ms avg`
    )
  }

  return summary
}

// ============================================================================
// Build dataset from production data
// ============================================================================

interface ProductionItem {
  id: string
  triggerMessage: {
    subject: string
    body: string
  }
  agentResponse?: {
    category: string
  }
}

export async function buildClassifyDataset(
  productionDataPath: string,
  outputPath: string
): Promise<void> {
  const content = await readFile(productionDataPath, 'utf-8')
  const production: ProductionItem[] = JSON.parse(content)

  // Map production categories to our categories
  const categoryMap: Record<string, MessageCategory> = {
    'tool-assisted': 'support_access', // Most common, will be manually refined
    auto: 'system',
    spam: 'spam',
  }

  const scenarios: ClassifyEvalScenario[] = production.map((item) => {
    // Infer category from message content (crude, needs manual review)
    const text =
      `${item.triggerMessage.subject} ${item.triggerMessage.body}`.toLowerCase()

    let category: MessageCategory = 'unknown'
    if (/refund|money back/i.test(text)) category = 'support_refund'
    else if (/can't access|lost access|no access/i.test(text))
      category = 'support_access'
    else if (/transfer|different email|wrong email/i.test(text))
      category = 'support_transfer'
    else if (/invoice|receipt/i.test(text)) category = 'support_billing'
    else if (/partnership|sponsor|backlink|outreach/i.test(text))
      category = 'spam'
    else if (/auto-reply|out of office|mailer-daemon/i.test(text))
      category = 'system'
    else if (
      /thank|love|amazing|big fan/i.test(text) &&
      /matt|pocock/i.test(text)
    )
      category = 'fan_mail'
    else category = 'support_technical'

    return {
      id: item.id,
      input: {
        subject: item.triggerMessage.subject,
        body: item.triggerMessage.body,
      },
      expected: { category },
      tags: [category],
    }
  })

  await writeFile(outputPath, JSON.stringify(scenarios, null, 2))
  console.log(`Built ${scenarios.length} scenarios → ${outputPath}`)
  console.log('⚠️  Categories are auto-inferred - review and correct manually!')
}
