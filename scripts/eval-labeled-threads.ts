#!/usr/bin/env bun
/**
 * Labeled Thread Eval
 * 
 * Evaluates thread pipeline against manually-reviewed/labeled scenarios.
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
  notes?: string
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
  const data = await readFile('fixtures/datasets/thread-scenarios-labeled.json', 'utf-8')
  const scenarios: ThreadScenario[] = JSON.parse(data)
  
  console.log('🏷️  Labeled Thread Eval (Fast Path)')
  console.log(`Dataset: ${scenarios.length} scenarios\n`)
  
  let passed = 0
  let failed = 0
  let fastPathCount = 0
  
  const failures: Array<{
    id: string
    name: string
    notes?: string
    expected: string
    actual: string
    reasoning?: string
    body?: string
  }> = []
  
  const categoryMatrix: Record<string, Record<string, number>> = {}
  
  for (const scenario of scenarios) {
    const signals = computeThreadSignals(scenario.input)
    
    // Fast path only
    let classification = fastClassifyThread(scenario.input, signals)
    if (classification) {
      fastPathCount++
    } else {
      classification = {
        category: 'unknown' as MessageCategory,
        confidence: 0,
        signals,
        reasoning: 'Needs LLM',
      }
    }
    
    const expectedCat = scenario.expected.category
    const actualCat = classification.category
    
    // Track matrix
    if (!categoryMatrix[expectedCat]) categoryMatrix[expectedCat] = {}
    categoryMatrix[expectedCat][actualCat] = (categoryMatrix[expectedCat][actualCat] || 0) + 1
    
    const isPassed = actualCat === expectedCat
    
    if (isPassed) {
      passed++
    } else {
      failed++
      failures.push({
        id: scenario.id,
        name: scenario.name,
        notes: scenario.notes,
        expected: expectedCat,
        actual: actualCat,
        reasoning: classification.reasoning,
        body: scenario.input.triggerMessage.body.slice(0, 80),
      })
    }
  }
  
  // Results
  console.log('📊 Results:\n')
  console.log(`Total: ${scenarios.length}`)
  console.log(`✅ Passed: ${passed} (${(100 * passed / scenarios.length).toFixed(1)}%)`)
  console.log(`❌ Failed: ${failed}`)
  console.log(`⚡ Fast path: ${fastPathCount}/${scenarios.length} (${(100 * fastPathCount / scenarios.length).toFixed(0)}%)`)
  
  console.log('\nConfusion Matrix (expected → actual):')
  for (const [expected, actuals] of Object.entries(categoryMatrix).sort()) {
    const total = Object.values(actuals).reduce((a, b) => a + b, 0)
    const correct = actuals[expected] || 0
    const pct = (100 * correct / total).toFixed(0)
    console.log(`  ${expected}: ${correct}/${total} (${pct}%)`)
    for (const [actual, count] of Object.entries(actuals).sort((a, b) => b[1] - a[1])) {
      if (actual !== expected) {
        console.log(`    → ${actual}: ${count}`)
      }
    }
  }
  
  if (failures.length > 0) {
    console.log(`\n❌ Failures (${failures.length}):`)
    for (const f of failures.slice(0, 20)) {
      console.log(`\n  ${f.id}: ${f.notes || f.name}`)
      console.log(`    Expected: ${f.expected} | Got: ${f.actual}`)
      console.log(`    Body: ${f.body}...`)
    }
  }
}

main().catch(console.error)
