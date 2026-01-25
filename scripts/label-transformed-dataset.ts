#!/usr/bin/env bun
/**
 * Label transformed eval dataset with classifier
 * 
 * Reads tt-combined-eval.json and runs each sample through classifyThread(),
 * updating expected.category with the result.
 * 
 * Works in batches with progress saving.
 */

import { readFile, writeFile } from 'fs/promises'
import { resolve } from 'path'
import { classifyThread } from '../packages/core/src/pipeline/steps/classify'
import type { ThreadClassifyInput } from '../packages/core/src/pipeline/types'

// Load env vars
const projectRoot = resolve(import.meta.dir, '..')
const cliEnvPath = resolve(projectRoot, 'packages/cli')
try {
  const dotenvFlow = await import('dotenv-flow')
  dotenvFlow.config({ path: cliEnvPath, silent: true })
  dotenvFlow.config({ path: projectRoot, silent: true })
} catch {
  // rely on shell environment
}

interface EvalSample {
  id: string
  conversationId: string
  app: string
  input: ThreadClassifyInput
  expected: {
    category: string
    action: string
  }
  tags: string[]
}

function getAction(category: string): string {
  switch (category) {
    case 'support_access':
    case 'support_refund':
    case 'support_transfer':
    case 'support_technical':
    case 'support_billing':
      return 'respond'
    case 'fan_mail':
    case 'voc_response':
      return 'escalate_instructor'
    default:
      return 'silence'
  }
}

async function main() {
  const inputPath = process.argv[2] || 'packages/cli/data/tt-combined-eval.json'
  const batchSize = parseInt(process.argv[3] || '25', 10)
  
  console.log(`📂 Loading ${inputPath}...`)
  const samples: EvalSample[] = JSON.parse(await readFile(inputPath, 'utf-8'))
  
  // Find samples that need labeling
  const unlabeled = samples.filter(s => 
    s.expected.category === 'unknown' || s.tags.includes('unlabeled')
  )
  
  console.log(`📊 Total samples: ${samples.length}`)
  console.log(`🔍 Unlabeled: ${unlabeled.length}`)
  
  if (unlabeled.length === 0) {
    console.log('✅ All samples already labeled!')
    return
  }
  
  // Process in batches
  let labeled = 0
  let failed = 0
  const startTime = Date.now()
  
  for (let batchStart = 0; batchStart < unlabeled.length; batchStart += batchSize) {
    const batchEnd = Math.min(batchStart + batchSize, unlabeled.length)
    const batch = unlabeled.slice(batchStart, batchEnd)
    
    console.log(`\n🔄 Processing batch ${Math.floor(batchStart / batchSize) + 1}/${Math.ceil(unlabeled.length / batchSize)} (${batchStart + 1}-${batchEnd})...`)
    
    // Process batch in parallel with concurrency limit
    const results = await Promise.allSettled(
      batch.map(async (sample) => {
        try {
          const result = await classifyThread(sample.input, {
            model: 'anthropic/claude-sonnet-4-5',
            forceLLM: true  // Force LLM for accurate labeling
          })
          
          // Update sample
          sample.expected.category = result.category
          sample.expected.action = getAction(result.category)
          sample.tags = sample.tags.filter(t => t !== 'unlabeled')
          sample.tags.push(result.category)
          sample.tags.push('llm_labeled')
          
          return { success: true, id: sample.id, category: result.category }
        } catch (error) {
          return { success: false, id: sample.id, error: String(error) }
        }
      })
    )
    
    // Count results
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value.success) {
        labeled++
        process.stdout.write('.')
      } else {
        failed++
        process.stdout.write('x')
      }
    }
    
    console.log('')
    
    // Save progress after each batch
    await writeFile(inputPath, JSON.stringify(samples, null, 2))
    console.log(`   💾 Saved progress (${labeled} labeled, ${failed} failed)`)
    
    // Rate limit between batches
    if (batchEnd < unlabeled.length) {
      await new Promise(r => setTimeout(r, 500))
    }
  }
  
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
  
  // Final stats
  const cats: Record<string, number> = {}
  for (const s of samples) {
    cats[s.expected.category] = (cats[s.expected.category] || 0) + 1
  }
  
  console.log(`\n📊 Final Stats:`)
  console.log(`   Total: ${samples.length}`)
  console.log(`   Labeled: ${labeled}`)
  console.log(`   Failed: ${failed}`)
  console.log(`   Time: ${elapsed}s`)
  console.log(`\n   By category:`)
  for (const [cat, count] of Object.entries(cats).sort((a, b) => b[1] - a[1])) {
    console.log(`     ${cat}: ${count}`)
  }
  
  console.log(`\n✅ Done!`)
}

main().catch(console.error)
