#!/usr/bin/env bun
/**
 * Thread v3 Eval
 * 
 * Evaluates the thread-aware pipeline against purpose-built thread scenarios.
 */

import { readFile } from 'fs/promises'
import { 
  classifyThread, 
  fastClassifyThread,
  computeThreadSignals,
  routeThread,
  type ThreadClassifyInput,
  type MessageCategory,
  type RouteAction,
  type AppConfig,
} from '../packages/core/src/pipeline/index'

interface ThreadScenario {
  id: string
  name: string
  input: ThreadClassifyInput
  expected: {
    category: MessageCategory
    action?: RouteAction
  }
  tags?: string[]
}

const appConfig: AppConfig = {
  appId: 'app_tt',
  instructorConfigured: true,
  instructorTeammateId: 'tea_matt',
  autoSendEnabled: false
}

async function main() {
  const data = await readFile('fixtures/datasets/thread-scenarios.json', 'utf-8')
  const scenarios: ThreadScenario[] = JSON.parse(data)
  
  console.log('🧵 Thread Pipeline v3 Eval')
  console.log(`Dataset: ${scenarios.length} scenarios\n`)
  
  let categoryPassed = 0
  let categoryFailed = 0
  let actionPassed = 0
  let actionFailed = 0
  let fastPathCount = 0
  
  const failures: Array<{
    id: string
    name: string
    expectedCat: string
    actualCat: string
    expectedAction?: string
    actualAction?: string
    reasoning?: string
  }> = []
  
  const tagStats: Record<string, { passed: number; failed: number }> = {}
  
  for (const scenario of scenarios) {
    // Ensure instructorTeammateId is set if in input
    const input = {
      ...scenario.input,
      instructorTeammateId: scenario.input.instructorTeammateId || appConfig.instructorTeammateId
    }
    
    const signals = computeThreadSignals(input)
    
    // Try fast path
    let classification = fastClassifyThread(input, signals)
    let usedFastPath = !!classification
    
    if (!classification) {
      // Skip LLM for fast eval, mark as unknown
      classification = {
        category: 'unknown' as MessageCategory,
        confidence: 0,
        signals,
        reasoning: 'Needs LLM',
      }
    } else {
      fastPathCount++
    }
    
    // Route
    const route = routeThread({ 
      classification, 
      appConfig: { ...appConfig, instructorTeammateId: input.instructorTeammateId }
    })
    
    // Check category
    const catPassed = classification.category === scenario.expected.category
    if (catPassed) categoryPassed++
    else categoryFailed++
    
    // Check action if expected
    let actPassed = true
    if (scenario.expected.action) {
      actPassed = route.action === scenario.expected.action
      if (actPassed) actionPassed++
      else actionFailed++
    }
    
    // Track failure
    if (!catPassed || !actPassed) {
      failures.push({
        id: scenario.id,
        name: scenario.name,
        expectedCat: scenario.expected.category,
        actualCat: classification.category,
        expectedAction: scenario.expected.action,
        actualAction: route.action,
        reasoning: classification.reasoning,
      })
    }
    
    // Track by tag
    for (const tag of scenario.tags || []) {
      if (!tagStats[tag]) tagStats[tag] = { passed: 0, failed: 0 }
      if (catPassed && actPassed) tagStats[tag].passed++
      else tagStats[tag].failed++
    }
  }
  
  // Results
  console.log('📊 Results:\n')
  console.log('Category Classification:')
  console.log(`  Total: ${scenarios.length}`)
  console.log(`  ✅ Passed: ${categoryPassed} (${(100 * categoryPassed / scenarios.length).toFixed(1)}%)`)
  console.log(`  ❌ Failed: ${categoryFailed}`)
  console.log(`  ⚡ Fast path: ${fastPathCount}/${scenarios.length} (${(100 * fastPathCount / scenarios.length).toFixed(0)}%)`)
  
  const actionTotal = scenarios.filter(s => s.expected.action).length
  if (actionTotal > 0) {
    console.log('\nAction Routing:')
    console.log(`  Total: ${actionTotal}`)
    console.log(`  ✅ Passed: ${actionPassed} (${(100 * actionPassed / actionTotal).toFixed(1)}%)`)
    console.log(`  ❌ Failed: ${actionFailed}`)
  }
  
  console.log('\nBy Tag:')
  for (const [tag, stats] of Object.entries(tagStats).sort((a, b) => a[0].localeCompare(b[0]))) {
    const total = stats.passed + stats.failed
    const pct = (100 * stats.passed / total).toFixed(0)
    const status = stats.failed === 0 ? '✅' : '❌'
    console.log(`  ${status} ${tag}: ${stats.passed}/${total} (${pct}%)`)
  }
  
  if (failures.length > 0) {
    console.log('\n❌ Failures:')
    for (const f of failures) {
      console.log(`\n  ${f.id}: ${f.name}`)
      console.log(`    Category: expected ${f.expectedCat}, got ${f.actualCat}`)
      if (f.expectedAction) {
        console.log(`    Action: expected ${f.expectedAction}, got ${f.actualAction}`)
      }
      if (f.reasoning) console.log(`    Reasoning: ${f.reasoning}`)
    }
  } else {
    console.log('\n🎉 All scenarios passed!')
  }
}

main().catch(console.error)
