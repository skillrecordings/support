#!/usr/bin/env bun
/**
 * POC: Generate response templates from real conversations
 * Uses Claude to analyze patterns and generate canonical templates
 */

import Anthropic from '@anthropic-ai/sdk'
import fs from 'node:fs'
import path from 'node:path'

const INPUT_PATH = path.join(
  process.cwd(),
  'artifacts/training-data/redacted-threads.jsonl'
)
const OUTPUT_PATH = path.join(
  process.cwd(),
  'artifacts/templates/poc-templates.yaml'
)

// Top 6 high-impact topics for POC
const POC_TOPICS = [
  'email_change_request',
  'refund_request',
  'login_link_not_received',
  'access_locked_out',
  'corporate_invoice_request',
  'ppp_pricing_inquiry',
]

const SAMPLES_PER_TOPIC = 30

interface ThreadEntry {
  topicId: string
  topicName: string
  question: string
  answer: string
}

const client = new Anthropic()

async function generateTemplate(topicName: string, samples: ThreadEntry[]): Promise<string> {
  const sampleText = samples
    .map((s, i) => `--- Sample ${i + 1} ---\nQ: ${s.question.slice(0, 300)}...\nA: ${s.answer}`)
    .join('\n\n')

  const response = await client.messages.create({
    model: 'claude-sonnet-4-[PHONE]',
    max_tokens: 2000,
    messages: [
      {
        role: 'user',
        content: `You are analyzing real customer support responses for the topic: "${topicName}"

Here are ${samples.length} real agent responses that successfully resolved tickets:

${sampleText}

Based on these real responses, create a YAML template specification:

1. Identify the common patterns and phrases used
2. Extract variables that change between responses (names, emails, amounts, products, etc.)
3. Generate 1-2 canonical templates that capture the most common response patterns
4. Note any conditional variations (e.g., "if refund already processed" vs "initiating refund")

Output YAML in this exact format:

topic_id: ${samples[0].topicId}
topic_name: ${topicName}
description: |
  Brief description of when to use this template
templates:
  - name: primary
    when: "Default case"
    template: |
      Hey {{customer_name}},
      
      [The actual template text with {{variables}}]
      
      Let me know if you have any questions!
    variables:
      - name: customer_name
        description: "Customer's first name"
        required: true
      - name: other_var
        description: "What this variable is"
        required: false
  - name: variant_name
    when: "Specific condition when to use this variant"
    template: |
      [Variant template if needed]
    variables: []
common_phrases:
  - "Phrase agents commonly use"
  - "Another common phrase"
tone_notes: |
  Notes about the tone and style observed in real responses

Only output the YAML, nothing else.`
      }
    ]
  })

  const text = response.content[0]
  if (text.type !== 'text') throw new Error('Unexpected response type')
  return text.text
}

async function main() {
  console.log('🔧 Generating template POC...\n')

  // Load all data
  const lines = fs.readFileSync(INPUT_PATH, 'utf-8').trim().split('\n')
  const allData: ThreadEntry[] = lines.map(l => JSON.parse(l))

  // Group by topic
  const byTopic = new Map<string, ThreadEntry[]>()
  for (const entry of allData) {
    const list = byTopic.get(entry.topicId) || []
    list.push(entry)
    byTopic.set(entry.topicId, list)
  }

  const outputDir = path.dirname(OUTPUT_PATH)
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true })
  }

  const results: string[] = []
  results.push('# Response Templates POC')
  results.push('# Generated from 14,095 real support conversations')
  results.push(`# Generated: ${new Date().toISOString()}`)
  results.push('')

  for (const topicId of POC_TOPICS) {
    const entries = byTopic.get(topicId) || []
    if (entries.length === 0) {
      console.log(`⚠️  No data for ${topicId}`)
      continue
    }

    const topicName = entries[0].topicName
    console.log(`📝 Processing: ${topicName} (${entries.length} samples available)`)

    // Sample randomly
    const shuffled = entries.sort(() => Math.random() - 0.5)
    const samples = shuffled.slice(0, SAMPLES_PER_TOPIC)

    try {
      const template = await generateTemplate(topicName, samples)
      results.push('---')
      results.push(template)
      results.push('')
      console.log(`   ✅ Generated template`)
    } catch (err) {
      console.log(`   ❌ Failed: ${err}`)
    }
  }

  fs.writeFileSync(OUTPUT_PATH, results.join('\n'))
  console.log(`\n✅ Done! Output: ${OUTPUT_PATH}`)
}

main().catch(err => {
  console.error('❌ Failed:', err)
  process.exit(1)
})
