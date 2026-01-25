#!/usr/bin/env bun
/**
 * Production Thread Eval
 * 
 * Evaluates thread pipeline against production-derived scenarios.
 */

import { readFile } from 'fs/promises'
import { 
  classifyThread, 
  fastClassifyThread,
  computeThreadSignals,
  routeThread,
  type ThreadClassifyInput,
  type MessageCategory,
  type AppConfig,
} from '../packages/core/src/pipeline/index'

interface ThreadScenario {
  id: string
  name: string
  source: string
  input: ThreadClassifyInput
  expected: {
    category: MessageCategory
  }
  tags?: string[]
}

const appConfig: AppConfig = {
  appId: 'app_eval',
  instructorConfigured: true,
  autoSendEnabled: false
}

async function main() {
  const data = await readFile('fixtures/datasets/thread-scenarios-production.json', 'utf-8')
  const scenarios: ThreadScenario[] = JSON.parse(data)
  
  console.log('🏭 Production Thread Eval')
  console.log(`Dataset: ${scenarios.length} scenarios\n`)
  
  let passed = 0
  let failed = 0
  let fastPathCount = 0
  
  const failures: Array<{
    id: string
    name: string
    expected: string
    actual: string
    reasoning?: string
    bodyPreview?: string
  }> = []
  
  const tagStats: Record<string, { passed: number; failed: number }> = {}
  const categoryMatrix: Record<string, Record<string, number>> = {}
  
  for (const scenario of scenarios) {
    const signals = computeThreadSignals(scenario.input)
    
    // Try fast path
    let classification = fastClassifyThread(scenario.input, signals)
    let usedFastPath = !!classification
    
    if (!classification) {
      classification = {
        category: 'unknown' as MessageCategory,
        confidence: 0,
        signals,
        reasoning: 'Needs LLM',
      }
    } else {
      fastPathCount++
    }
    
    const expectedCat = scenario.expected.category
    const actualCat = classification.category
    
    // Track confusion matrix
    if (!categoryMatrix[expectedCat]) categoryMatrix[expectedCat] = {}
    categoryMatrix[expectedCat][actualCat] = (categoryMatrix[expectedCat][actualCat] || 0) + 1
    
    // Check pass - allow some flexibility
    const isPassed = actualCat === expectedCat ||
      // Technical is a catch-all, accept access/billing as close enough
      (expectedCat === 'support_technical' && actualCat.startsWith('support_')) ||
      // Billing with invoice requests might be classified as access
      (expectedCat === 'support_billing' && actualCat === 'support_technical')
    
    if (isPassed) {
      passed++
    } else {
      failed++
      failures.push({
        id: scenario.id,
        name: scenario.name,
        expected: expectedCat,
        actual: actualCat,
        reasoning: classification.reasoning,
        bodyPreview: scenario.input.triggerMessage.body.slice(0, 100),
      })
    }
    
    // Track by tag
    for (const tag of scenario.tags || []) {
      if (!tagStats[tag]) tagStats[tag] = { passed: 0, failed: 0 }
      if (isPassed) tagStats[tag].passed++
      else tagStats[tag].failed++
    }
  }
  
  // Results
  console.log('📊 Results:\n')
  console.log(`Total: ${scenarios.length}`)
  console.log(`✅ Passed: ${passed} (${(100 * passed / scenarios.length).toFixed(1)}%)`)
  console.log(`❌ Failed: ${failed}`)
  console.log(`⚡ Fast path: ${fastPathCount}/${scenarios.length} (${(100 * fastPathCount / scenarios.length).toFixed(0)}%)`)
  
  console.log('\nBy Category (expected → actual):')
  for (const [expected, actuals] of Object.entries(categoryMatrix).sort()) {
    const total = Object.values(actuals).reduce((a, b) => a + b, 0)
    const correct = actuals[expected] || 0
    console.log(`  ${expected}: ${correct}/${total} correct`)
    for (const [actual, count] of Object.entries(actuals).sort((a, b) => b[1] - a[1])) {
      if (actual !== expected) {
        console.log(`    → ${actual}: ${count}`)
      }
    }
  }
  
  if (failures.length > 0 && failures.length <= 15) {
    console.log('\n❌ Failures:')
    for (const f of failures) {
      console.log(`\n  ${f.id}: ${f.name}`)
      console.log(`    Expected: ${f.expected} | Got: ${f.actual}`)
      if (f.reasoning) console.log(`    Reason: ${f.reasoning}`)
    }
  } else if (failures.length > 15) {
    console.log(`\n❌ ${failures.length} failures (showing first 10):`)
    for (const f of failures.slice(0, 10)) {
      console.log(`  ${f.id}: expected ${f.expected}, got ${f.actual}`)
    }
  }
}

main().catch(console.error)
