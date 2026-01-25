#!/usr/bin/env bun
import { readFile } from 'fs/promises'
import { fastClassifyThread, computeThreadSignals, routeThread } from '../packages/core/src/pipeline/index'

async function main() {
  const data = await readFile('fixtures/datasets/real-threads.json', 'utf-8')
  const scenarios = JSON.parse(data)
  
  console.log('🔬 Real Thread Eval\n')
  
  let catPass = 0, catFail = 0
  let actPass = 0, actFail = 0
  let fastPath = 0
  
  const catMatrix: Record<string, Record<string, number>> = {}
  const actMatrix: Record<string, Record<string, number>> = {}
  const failures: any[] = []
  
  for (const s of scenarios) {
    const signals = computeThreadSignals(s.input)
    const classResult = fastClassifyThread(s.input, signals)
    
    const actualCat = classResult?.category || 'unknown'
    const expectedCat = s.expected.category
    
    if (classResult) fastPath++
    
    // Category matrix
    if (!catMatrix[expectedCat]) catMatrix[expectedCat] = {}
    catMatrix[expectedCat][actualCat] = (catMatrix[expectedCat][actualCat] || 0) + 1
    
    if (actualCat === expectedCat) catPass++
    else {
      catFail++
      failures.push({
        id: s.id,
        notes: s.notes,
        expCat: expectedCat,
        actCat: actualCat,
        expAct: s.expected.action,
        body: s.input.triggerMessage.body.slice(0, 60),
      })
    }
    
    // Route
    const mockClass = classResult || { category: actualCat, confidence: 0, signals, reasoning: '' }
    const route = routeThread({ classification: mockClass, appConfig: { appId: 'test', instructorConfigured: true, autoSendEnabled: false } })
    
    if (!actMatrix[s.expected.action]) actMatrix[s.expected.action] = {}
    actMatrix[s.expected.action][route.action] = (actMatrix[s.expected.action][route.action] || 0) + 1
    
    if (route.action === s.expected.action) actPass++
    else actFail++
  }
  
  console.log(`Total: ${scenarios.length}`)
  console.log(`Fast path: ${fastPath}/${scenarios.length} (${Math.round(100*fastPath/scenarios.length)}%)`)
  console.log(`\nCategory: ${catPass}/${scenarios.length} (${Math.round(100*catPass/scenarios.length)}%)`)
  console.log(`Action: ${actPass}/${scenarios.length} (${Math.round(100*actPass/scenarios.length)}%)`)
  
  console.log('\n--- Category Matrix ---')
  for (const [exp, acts] of Object.entries(catMatrix).sort()) {
    const total = Object.values(acts).reduce((a, b) => a + b, 0)
    const correct = acts[exp] || 0
    console.log(`${exp}: ${correct}/${total} (${Math.round(100*correct/total)}%)`)
    for (const [act, n] of Object.entries(acts).filter(([k]) => k !== exp)) {
      console.log(`  → ${act}: ${n}`)
    }
  }
  
  console.log('\n--- Action Matrix ---')
  for (const [exp, acts] of Object.entries(actMatrix).sort()) {
    const total = Object.values(acts).reduce((a, b) => a + b, 0)
    const correct = acts[exp] || 0
    console.log(`${exp}: ${correct}/${total} (${Math.round(100*correct/total)}%)`)
    for (const [act, n] of Object.entries(acts).filter(([k]) => k !== exp)) {
      console.log(`  → ${act}: ${n}`)
    }
  }
  
  if (failures.length > 0) {
    console.log(`\n--- Category Failures (${failures.length}) ---`)
    for (const f of failures.slice(0, 15)) {
      console.log(`${f.id}: ${f.notes}`)
      console.log(`  exp: ${f.expCat} → got: ${f.actCat}`)
      console.log(`  "${f.body}..."`)
    }
  }
}

main()
