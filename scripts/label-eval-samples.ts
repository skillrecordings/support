#!/usr/bin/env bun
/**
 * Label eval samples using the classifier
 * 
 * Takes transformed eval samples (with expected: unknown) and runs them
 * through classifyThread to get predictions, saving those as expected values.
 * 
 * Usage: bun scripts/label-eval-samples.ts <input.json> <output.json>
 */

import { readFile, writeFile } from 'fs/promises'
import { resolve } from 'path'
import { 
  classifyThread,
  type ThreadClassifyInput,
} from '../packages/core/src/pipeline/index'

// Load env vars from packages/cli
const projectRoot = resolve(import.meta.dir, '..')
const cliEnvPath = resolve(projectRoot, 'packages/cli')
try {
  const dotenvFlow = await import('dotenv-flow')
  dotenvFlow.config({ path: cliEnvPath, silent: true })
  dotenvFlow.config({ path: projectRoot, silent: true })
} catch {
  // dotenv-flow not available, rely on shell environment
}

interface EvalSample {
  id: string
  conversationId: string
  app: string
  notes?: string
  input: {
    conversationId: string
    appId: string
    messages: Array<{ direction: string; body: string }>
    triggerMessage: { direction: string; body: string }
  }
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
      return 'escalate_instructor'
    default:
      return 'silence'
  }
}

async function main() {
  const [inputPath, outputPath] = process.argv.slice(2)
  
  if (!inputPath || !outputPath) {
    console.log('Usage: bun scripts/label-eval-samples.ts <input.json> <output.json>')
    process.exit(1)
  }

  const fullInput = resolve(process.cwd(), inputPath)
  const fullOutput = resolve(process.cwd(), outputPath)

  console.log(`📂 Reading ${fullInput}...`)
  const samples: EvalSample[] = JSON.parse(await readFile(fullInput, 'utf-8'))
  console.log(`   Found ${samples.length} samples to label`)

  const labeled: EvalSample[] = []
  let success = 0
  let failed = 0

  for (let i = 0; i < samples.length; i++) {
    process.stdout.write(`\r   Labeling ${i + 1}/${samples.length}...`)
    
    const sample = samples[i]
    
    try {
      // Build thread input for classifier
      const threadInput: ThreadClassifyInput = {
        conversationId: sample.input.conversationId,
        appId: sample.input.appId,
        messages: sample.input.messages.map(m => ({
          direction: m.direction as 'in' | 'out',
          body: m.body,
        })),
        triggerMessage: {
          direction: sample.input.triggerMessage.direction as 'in' | 'out',
          body: sample.input.triggerMessage.body,
        },
      }

      const result = await classifyThread(threadInput, { 
        model: 'anthropic/claude-sonnet-4-5',
        forceLLM: true,  // Always use LLM for consistent labeling
      })

      labeled.push({
        ...sample,
        notes: result.reasoning.slice(0, 100),
        expected: {
          category: result.category,
          action: getAction(result.category),
        },
        tags: [
          result.category,
          getAction(result.category),
          sample.input.messages.length === 1 ? 'single' : 'multi_turn',
          'llm_labeled',
        ],
      })
      success++

      // Rate limit
      await new Promise(r => setTimeout(r, 100))
    } catch (error) {
      console.error(`\nFailed to label ${sample.id}:`, error)
      failed++
    }
  }

  console.log(`\n   ✅ Labeled: ${success}, Failed: ${failed}`)

  await writeFile(fullOutput, JSON.stringify(labeled, null, 2))
  console.log(`\n📊 Category distribution:`)
  
  const cats: Record<string, number> = {}
  for (const s of labeled) {
    cats[s.expected.category] = (cats[s.expected.category] || 0) + 1
  }
  for (const [cat, count] of Object.entries(cats).sort((a, b) => b[1] - a[1])) {
    console.log(`   ${cat}: ${count}`)
  }

  console.log(`\n✅ Saved ${labeled.length} labeled samples to ${fullOutput}`)
}

main().catch(console.error)
