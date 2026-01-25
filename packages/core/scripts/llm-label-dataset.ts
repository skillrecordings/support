#!/usr/bin/env bun
/**
 * LLM-Powered Dataset Labeling
 * 
 * Uses Claude to label threads accurately via Vercel AI Gateway.
 * Much more reliable than regex patterns.
 * 
 * Requires AI_GATEWAY_API_KEY (preferred) or VERCEL_OIDC_TOKEN.
 */

import { readFile, writeFile } from 'fs/promises'
import { resolve } from 'path'
import { generateObject } from 'ai'
import { z } from 'zod'

// Load env vars - try packages/cli first (has stable AI_GATEWAY_API_KEY), then root
const projectRoot = resolve(import.meta.dir, '../../..')
const cliEnvPath = resolve(projectRoot, 'packages/cli')
try {
  const dotenvFlow = await import('dotenv-flow')
  dotenvFlow.config({ path: cliEnvPath, silent: true })
  dotenvFlow.config({ path: projectRoot, silent: true })
} catch {
  // dotenv-flow not available, rely on shell environment
}

// Validate gateway auth is present (prefer stable API key over OIDC)
if (!process.env.AI_GATEWAY_API_KEY && !process.env.VERCEL_OIDC_TOKEN) {
  console.error(`
❌ AI Gateway auth not found!

This script uses the Vercel AI Gateway. Set one of:
  AI_GATEWAY_API_KEY=vck_...  (preferred, stable)
  VERCEL_OIDC_TOKEN=eyJ...    (expires, needs refresh)

Pull from Vercel: cd packages/cli && vercel env pull .env.local
`)
  process.exit(1)
}

// Model to use (via Vercel AI Gateway)
// ALWAYS use versionless names: claude-haiku-4-5, claude-sonnet-4-5, claude-opus-4-5
const MODEL = 'anthropic/claude-sonnet-4-5'

interface RawThread {
  id: string
  conversationId: string
  subject: string
  status: string
  category: string
  tags: string[]
  customerEmail: string
  conversationHistory: Array<{
    body: string
    direction: 'in' | 'out'
    timestamp?: string
  }>
  triggerMessage: {
    body: string
    direction: string
  }
}

interface LabeledThread {
  id: string
  conversationId: string
  app: string
  notes: string
  input: {
    conversationId: string
    appId: string
    messages: Array<{
      direction: string
      body: string
    }>
    triggerMessage: {
      body: string
      direction: string
    }
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
    .replace(/\b[A-Z][a-z]+ [A-Z][a-z]+\b/g, 'Customer Name') // Full names
}

const LABEL_PROMPT = `You are labeling a support email thread for a classifier eval dataset.

Classify this thread into ONE category based on what action should be taken NOW:

CATEGORIES:
- support_access: Customer can't access purchased content (login issues, missing access)
- support_refund: Customer wants their money back
- support_transfer: Customer wants to move purchase to different email
- support_technical: Questions about course content, code, technical issues
- support_billing: Needs invoice, receipt, or tax documents
- fan_mail: Appreciation, survey responses, sharing their journey (route to instructor)
- spam: Vendor outreach, partnership pitches, marketing
- system: Automated messages, bounces
- instructor_strategy: Internal team discussion
- resolved: Thread is DONE - we helped and customer confirmed
- awaiting_customer: We asked a question, waiting for customer's reply

IMPORTANT:
- If thread shows back-and-forth AND ends with resolution (thanks, got it, works now) → resolved
- If our last message asked a question → awaiting_customer
- Classify by CURRENT STATE, not original request type
- A processed refund where customer said thanks → resolved, NOT support_refund

Thread status: {status}
Thread length: {msgCount} messages

Provide category, confidence (0-1), and brief reasoning.`

const LabelSchema = z.object({
  category: z.enum([
    'support_access',
    'support_refund', 
    'support_transfer',
    'support_technical',
    'support_billing',
    'fan_mail',
    'spam',
    'system',
    'instructor_strategy',
    'resolved',
    'awaiting_customer',
  ]),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
  originalRequestType: z.string().optional(), // What it was about before resolution
})

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

async function labelThread(thread: RawThread, appId: string): Promise<LabeledThread | null> {
  // Build thread text for LLM
  const messages = thread.conversationHistory.map((m, i) => {
    const dir = m.direction === 'in' ? 'CUSTOMER' : 'TEAM'
    return `[${i + 1}] ${dir}: ${scrubPII(m.body.slice(0, 500))}`
  }).join('\n\n')
  
  const prompt = LABEL_PROMPT
    .replace('{status}', thread.status)
    .replace('{msgCount}', String(thread.conversationHistory.length))
  
  try {
    const { object } = await generateObject({
      model: MODEL,
      schema: LabelSchema,
      system: prompt,
      prompt: `Subject: ${thread.subject}\n\n${messages}`,
    })
    
    // Build labeled thread
    const scrubbedMessages = thread.conversationHistory.map(m => ({
      direction: m.direction,
      body: scrubPII(m.body),
    }))
    
    return {
      id: `labeled_${thread.id.slice(4, 12)}`,
      conversationId: thread.conversationId,
      app: appId,
      notes: object.reasoning.slice(0, 100),
      input: {
        conversationId: thread.conversationId,
        appId,
        messages: scrubbedMessages,
        triggerMessage: scrubbedMessages[scrubbedMessages.length - 1] || { body: '', direction: 'in' },
      },
      expected: {
        category: object.category,
        action: getAction(object.category),
      },
      tags: [
        object.category,
        getAction(object.category),
        scrubbedMessages.length === 1 ? 'single' : 'multi_turn',
        thread.status,
        'llm_labeled',
      ],
    }
  } catch (error) {
    console.error(`Failed to label ${thread.id}:`, error)
    return null
  }
}

async function main() {
  const files = process.argv.slice(2)
  if (files.length === 0) {
    console.log('Usage: bun scripts/llm-label-dataset.ts <input.json> [input2.json...] [-o output.json]')
    console.log('\nExamples:')
    console.log('  bun scripts/llm-label-dataset.ts data/tt-archived.json')
    console.log('  bun scripts/llm-label-dataset.ts data/tt-archived.json data/aihero-archived.json -o data/llm-labeled.json')
    return
  }
  
  // Parse args
  const outputIdx = files.indexOf('-o')
  const outputPath = outputIdx >= 0 ? files[outputIdx + 1] : 'fixtures/datasets/llm-labeled.json'
  const inputFiles = outputIdx >= 0 ? files.slice(0, outputIdx) : files
  
  const allLabeled: LabeledThread[] = []
  
  for (const inputPath of inputFiles) {
    console.log(`\n📂 Processing ${inputPath}...`)
    const raw: RawThread[] = JSON.parse(await readFile(inputPath, 'utf-8'))
    
    // Detect app from path
    const appId = inputPath.includes('aihero') ? 'ai-hero' 
      : inputPath.includes('tt') ? 'total-typescript'
      : 'unknown'
    
    console.log(`   Found ${raw.length} threads (app: ${appId})`)
    
    // Label each thread
    let labeled = 0
    let failed = 0
    
    for (let i = 0; i < raw.length; i++) {
      process.stdout.write(`\r   Labeling ${i + 1}/${raw.length}...`)
      
      const result = await labelThread(raw[i], appId)
      if (result) {
        allLabeled.push(result)
        labeled++
      } else {
        failed++
      }
      
      // Rate limit
      await new Promise(r => setTimeout(r, 100))
    }
    
    console.log(`\n   ✅ Labeled: ${labeled}, Failed: ${failed}`)
  }
  
  // Save
  await writeFile(outputPath, JSON.stringify(allLabeled, null, 2))
  
  // Stats
  const cats: Record<string, number> = {}
  for (const l of allLabeled) {
    cats[l.expected.category] = (cats[l.expected.category] || 0) + 1
  }
  
  console.log(`\n📊 Final Dataset:`)
  console.log(`   Total: ${allLabeled.length}`)
  console.log(`\n   By category:`)
  for (const [cat, count] of Object.entries(cats).sort((a, b) => b[1] - a[1])) {
    console.log(`     ${cat}: ${count}`)
  }
  
  console.log(`\n✅ Saved to ${outputPath}`)
}

main().catch(console.error)
