#!/usr/bin/env bun
/**
 * Production Thread Eval WITH LLM
 * 
 * Full eval including LLM classification for messages that don't hit fast path.
 * Requires ANTHROPIC_API_KEY.
 */

import { readFile } from 'fs/promises'
import { 
  classifyThread,
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
  // Parse args: [dataset] [limit]
  const datasetPath = process.argv[2] || 'fixtures/datasets/llm-labeled.json'
  const limit = parseInt(process.argv[3] || '100')
  
  const data = await readFile(datasetPath, 'utf-8')
  const scenarios: ThreadScenario[] = JSON.parse(data)
  const testScenarios = scenarios.slice(0, limit)
  
  console.log('🏭 Production Thread Eval (with LLM)')
  console.log(`Dataset: ${datasetPath} (${testScenarios.length} scenarios)\n`)
  
  let passed = 0
  let failed = 0
  let fastPathCount = 0
  const latencies: number[] = []
  
  const failures: Array<{
    id: string
    expected: string
    actual: string
    reasoning?: string
  }> = []
  
  const categoryMatrix: Record<string, Record<string, number>> = {}
  
  for (let i = 0; i < testScenarios.length; i++) {
    const scenario = testScenarios[i]
    process.stdout.write(`\rProcessing ${i + 1}/${testScenarios.length}...`)
    
    const start = Date.now()
    
    try {
      const classification = await classifyThread(scenario.input)
      const latency = Date.now() - start
      latencies.push(latency)
      
      // Check if fast path was used (latency < 50ms usually means no LLM)
      if (latency < 100) fastPathCount++
      
      const expectedCat = scenario.expected.category
      const actualCat = classification.category
      
      // Track confusion matrix
      if (!categoryMatrix[expectedCat]) categoryMatrix[expectedCat] = {}
      categoryMatrix[expectedCat][actualCat] = (categoryMatrix[expectedCat][actualCat] || 0) + 1
      
      // Check pass
      const isPassed = actualCat === expectedCat ||
        // Support_technical is catch-all
        (expectedCat === 'support_technical' && actualCat.startsWith('support_'))
      
      if (isPassed) {
        passed++
      } else {
        failed++
        failures.push({
          id: scenario.id,
          expected: expectedCat,
          actual: actualCat,
          reasoning: classification.reasoning,
        })
      }
    } catch (error) {
      failed++
      failures.push({
        id: scenario.id,
        expected: scenario.expected.category,
        actual: 'ERROR',
        reasoning: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }
  
  console.log('\n')
  
  // Results
  console.log('📊 Results:\n')
  console.log(`Total: ${testScenarios.length}`)
  console.log(`✅ Passed: ${passed} (${(100 * passed / testScenarios.length).toFixed(1)}%)`)
  console.log(`❌ Failed: ${failed}`)
  console.log(`⚡ Fast path: ~${fastPathCount}/${testScenarios.length} (${(100 * fastPathCount / testScenarios.length).toFixed(0)}%)`)
  
  if (latencies.length > 0) {
    latencies.sort((a, b) => a - b)
    console.log(`\nLatency:`)
    console.log(`  p50: ${latencies[Math.floor(latencies.length * 0.5)]}ms`)
    console.log(`  p95: ${latencies[Math.floor(latencies.length * 0.95)]}ms`)
    console.log(`  avg: ${Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)}ms`)
  }
  
  console.log('\nBy Category (expected → actual):')
  for (const [expected, actuals] of Object.entries(categoryMatrix).sort()) {
    const total = Object.values(actuals).reduce((a, b) => a + b, 0)
    const correct = actuals[expected] || 0
    const pct = (100 * correct / total).toFixed(0)
    console.log(`  ${expected}: ${correct}/${total} (${pct}%)`)
    for (const [actual, count] of Object.entries(actuals).sort((a, b) => b[1] - a[1])) {
      if (actual !== expected && count > 0) {
        console.log(`    → ${actual}: ${count}`)
      }
    }
  }
  
  if (failures.length > 0 && failures.length <= 15) {
    console.log('\n❌ Failures:')
    for (const f of failures) {
      console.log(`  ${f.id}: expected ${f.expected}, got ${f.actual}`)
      if (f.reasoning) console.log(`    → ${f.reasoning?.slice(0, 80)}`)
    }
  }
}

main().catch(console.error)
