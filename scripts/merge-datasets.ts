#!/usr/bin/env bun
/**
 * Merge multiple labeled datasets, dedupe by conversationId
 */

import { readFile, writeFile } from 'fs/promises'

interface LabeledSample {
  id: string
  conversationId: string
  app: string
  expected: {
    category: string
    action: string
  }
  tags: string[]
  [key: string]: unknown
}

async function main() {
  const args = process.argv.slice(2)
  if (args.length < 2) {
    console.log('Usage: bun scripts/merge-datasets.ts <output.json> <input1.json> [input2.json...]')
    return
  }
  
  const outputPath = args[0]
  const inputPaths = args.slice(1)
  
  const allSamples: LabeledSample[] = []
  const seenIds = new Set<string>()
  
  for (const path of inputPaths) {
    console.log(`📂 Loading ${path}...`)
    const samples: LabeledSample[] = JSON.parse(await readFile(path, 'utf-8'))
    
    let added = 0
    let dupes = 0
    for (const sample of samples) {
      if (seenIds.has(sample.conversationId)) {
        dupes++
        continue
      }
      seenIds.add(sample.conversationId)
      allSamples.push(sample)
      added++
    }
    
    console.log(`   Added: ${added}, Duplicates: ${dupes}`)
  }
  
  // Stats
  const cats: Record<string, number> = {}
  const apps: Record<string, number> = {}
  for (const s of allSamples) {
    cats[s.expected.category] = (cats[s.expected.category] || 0) + 1
    apps[s.app] = (apps[s.app] || 0) + 1
  }
  
  await writeFile(outputPath, JSON.stringify(allSamples, null, 2))
  
  console.log(`\n📊 Merged Dataset:`)
  console.log(`   Total: ${allSamples.length}`)
  console.log(`\n   By app:`)
  for (const [app, count] of Object.entries(apps).sort((a, b) => b[1] - a[1])) {
    console.log(`     ${app}: ${count}`)
  }
  console.log(`\n   By category:`)
  for (const [cat, count] of Object.entries(cats).sort((a, b) => b[1] - a[1])) {
    console.log(`     ${cat}: ${count}`)
  }
  
  console.log(`\n✅ Saved to ${outputPath}`)
}

main().catch(console.error)
