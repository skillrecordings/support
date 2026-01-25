#!/usr/bin/env bun
/**
 * Transform Front pull format to eval format
 * 
 * Usage: bun scripts/transform-front-to-eval.ts <input.json> <output.json>
 */

import { readFile, writeFile } from 'fs/promises'
import { resolve } from 'path'

// Input format from Front pull
interface FrontConversation {
  id: string
  conversationId: string
  subject: string
  customerEmail: string
  status: string
  tags: string[]
  category?: string
  triggerMessage: {
    id: string
    subject: string
    body: string
    timestamp: number
  }
  conversationHistory: Array<{
    direction: 'in' | 'out'
    body: string
    timestamp: number
  }>
}

// Output eval format
interface EvalSample {
  id: string
  conversationId: string
  app: string
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

// PII scrubbing
function scrubPII(text: string): string {
  return text
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi, 'user@example.com')
    .replace(/\b[A-Z][a-z]+ [A-Z][a-z]+\b/g, 'Customer Name')
}

function transform(conv: FrontConversation, appId: string): EvalSample {
  const messages = conv.conversationHistory.map(m => ({
    direction: m.direction,
    body: scrubPII(m.body),
  }))

  // Use last message as trigger message (or first if empty)
  const triggerMsg = messages[messages.length - 1] || { direction: 'in', body: '' }

  return {
    id: `labeled_${conv.conversationId.slice(4)}`,
    conversationId: conv.conversationId,
    app: appId,
    input: {
      conversationId: conv.conversationId,
      appId,
      messages,
      triggerMessage: triggerMsg,
    },
    expected: {
      category: 'unknown',
      action: 'unknown',
    },
    tags: ['unlabeled', 'front_pull'],
  }
}

async function main() {
  const [inputPath, outputPath] = process.argv.slice(2)
  
  if (!inputPath || !outputPath) {
    console.log('Usage: bun scripts/transform-front-to-eval.ts <input.json> <output.json>')
    process.exit(1)
  }

  const fullInput = resolve(process.cwd(), inputPath)
  const fullOutput = resolve(process.cwd(), outputPath)

  console.log(`📂 Reading ${fullInput}...`)
  const data: FrontConversation[] = JSON.parse(await readFile(fullInput, 'utf-8'))
  
  // Detect app from path
  const appId = inputPath.includes('aihero') || inputPath.includes('ai-hero')
    ? 'ai-hero'
    : 'total-typescript'
  
  console.log(`   Found ${data.length} conversations (app: ${appId})`)

  const samples = data.map(conv => transform(conv, appId))

  await writeFile(fullOutput, JSON.stringify(samples, null, 2))
  console.log(`✅ Wrote ${samples.length} samples to ${fullOutput}`)
}

main().catch(console.error)
