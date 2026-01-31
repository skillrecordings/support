#!/usr/bin/env bun
/**
 * FAQ Extraction from LLM Topic Classifications
 * 
 * Reads classifications.json, groups by topic, extracts Q&A pairs.
 * Resumable: writes to JSONL after each topic, skips completed topics on restart.
 * 
 * Usage:
 *   bun scripts/extract-faq-from-topics.ts [--dry-run] [--topic <topicId>]
 */

import * as path from 'path'
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'fs'
import { execSync } from 'child_process'
import { generateObject } from 'ai'
import { z } from 'zod'

const MODEL = 'anthropic/claude-haiku-4-5'

// Validate env
if (!process.env.AI_GATEWAY_API_KEY) {
  console.error('❌ AI_GATEWAY_API_KEY not set. Run: source packages/cli/.env.local')
  process.exit(1)
}

const CLASSIFICATIONS_PATH = 'artifacts/phase-1/llm-topics/classifications.json'
const OUTPUT_PATH = 'artifacts/phase-1/llm-topics/faq-candidates.jsonl'
const PROGRESS_PATH = 'artifacts/phase-1/llm-topics/extraction-progress.json'
const DB_PATH = '~/skill/data/front-cache.db'

const MIN_TOPIC_SIZE = 10 // Skip topics with fewer conversations
const MAX_CANDIDATES_PER_TOPIC = 5 // Top N candidates per topic
const MIN_CONFIDENCE = 0.7 // Skip low-confidence classifications

// Topics to skip (noise, not FAQ-worthy)
const SKIP_TOPICS = new Set(['other', 'unknown', 'spam', 'auto_reply', 'out_of_office'])

interface Classification {
  conversationId: string
  topicId: string
  confidence: number
  firstMessage: string
}

interface Message {
  id: string
  conversation_id: string
  body_text: string
  is_inbound: boolean
  author_email: string
  created_at: string
}

interface FaqCandidate {
  topicId: string
  question: string
  answer: string
  confidence: number
  sourceConversations: string[]
  extractedAt: string
  threadLength: number
  qualityScore: number
}

interface Progress {
  completedTopics: string[]
  lastUpdated: string
}

function loadProgress(): Progress {
  if (existsSync(PROGRESS_PATH)) {
    return JSON.parse(readFileSync(PROGRESS_PATH, 'utf-8'))
  }
  return { completedTopics: [], lastUpdated: new Date().toISOString() }
}

function saveProgress(progress: Progress) {
  progress.lastUpdated = new Date().toISOString()
  writeFileSync(PROGRESS_PATH, JSON.stringify(progress, null, 2))
}

function loadClassifications(): Classification[] {
  console.log('Loading classifications...')
  const data = JSON.parse(readFileSync(CLASSIFICATIONS_PATH, 'utf-8'))
  console.log(`Loaded ${data.length} classifications`)
  return data
}

function groupByTopic(classifications: Classification[]): Map<string, Classification[]> {
  const groups = new Map<string, Classification[]>()
  
  for (const c of classifications) {
    if (c.confidence < MIN_CONFIDENCE) continue
    if (SKIP_TOPICS.has(c.topicId)) continue
    
    if (!groups.has(c.topicId)) {
      groups.set(c.topicId, [])
    }
    groups.get(c.topicId)!.push(c)
  }
  
  // Sort by confidence within each topic
  for (const [topic, items] of groups) {
    items.sort((a, b) => b.confidence - a.confidence)
  }
  
  return groups
}

function getConversationMessages(conversationId: string): Message[] {
  try {
    const query = `
      SELECT id, conversation_id, body_text, is_inbound, author_email, created_at
      FROM messages 
      WHERE conversation_id = '${conversationId}'
      ORDER BY created_at ASC
    `
    const result = execSync(
      `duckdb -readonly "${DB_PATH}" -json -c "${query.replace(/"/g, '\\"')}"`,
      { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
    )
    return JSON.parse(result)
  } catch (e) {
    console.error(`Failed to get messages for ${conversationId}:`, e)
    return []
  }
}

function extractBestResponse(messages: Message[]): { response: string; threadLength: number } | null {
  // Find first outbound (agent) message that's substantial
  const agentMessages = messages.filter(m => !m.is_inbound && m.body_text?.length > 50)
  
  if (agentMessages.length === 0) return null
  
  // Prefer responses that aren't just "thanks for reaching out"
  const substantialResponse = agentMessages.find(m => 
    m.body_text.length > 200 && 
    !m.body_text.toLowerCase().includes('thanks for reaching out') &&
    !m.body_text.toLowerCase().includes('thank you for contacting')
  ) || agentMessages[0]
  
  return {
    response: substantialResponse.body_text,
    threadLength: messages.length
  }
}

async function generateCanonicalQA(
  topic: string,
  samples: { question: string; answer: string }[]
): Promise<{ question: string; answer: string } | null> {
  try {
    const result = await generateObject({
      model: MODEL,
      schema: z.object({
        question: z.string().describe('A clear, canonical question that represents this topic'),
        answer: z.string().describe('A helpful, complete answer to the question'),
      }),
      prompt: `You are creating FAQ content for a software education platform (courses on TypeScript, React, etc).

Topic: ${topic}

Here are ${samples.length} real customer questions and agent responses for this topic:

${samples.slice(0, 5).map((s, i) => `
--- Example ${i + 1} ---
Customer: ${s.question.slice(0, 500)}
Agent: ${s.answer.slice(0, 500)}
`).join('\n')}

Create ONE canonical FAQ entry that:
1. Captures the most common variant of this question
2. Provides a clear, helpful answer
3. Uses a friendly but professional tone
4. Is self-contained (doesn't reference specific people or orders)

Return the question and answer.`,
    })
    
    return result.object
  } catch (e) {
    console.error(`Failed to generate canonical Q&A for ${topic}:`, e)
    return null
  }
}

async function extractTopicCandidates(
  topic: string,
  classifications: Classification[]
): Promise<FaqCandidate[]> {
  console.log(`\nProcessing topic: ${topic} (${classifications.length} conversations)`)
  
  const samples: { question: string; answer: string; convId: string; threadLength: number }[] = []
  
  // Get Q&A pairs from top conversations
  for (const c of classifications.slice(0, 20)) {
    const messages = getConversationMessages(c.conversationId)
    if (messages.length < 2) continue
    
    const firstInbound = messages.find(m => m.is_inbound)
    if (!firstInbound) continue
    
    const responseData = extractBestResponse(messages)
    if (!responseData) continue
    
    samples.push({
      question: firstInbound.body_text,
      answer: responseData.response,
      convId: c.conversationId,
      threadLength: responseData.threadLength,
    })
    
    if (samples.length >= 10) break
  }
  
  if (samples.length < 3) {
    console.log(`  Skipping: not enough quality samples (${samples.length})`)
    return []
  }
  
  // Generate canonical Q&A
  const canonical = await generateCanonicalQA(topic, samples)
  if (!canonical) {
    console.log(`  Skipping: failed to generate canonical Q&A`)
    return []
  }
  
  const avgThreadLength = samples.reduce((sum, s) => sum + s.threadLength, 0) / samples.length
  const qualityScore = Math.min(1, samples.length / 10) * (1 - avgThreadLength / 20)
  
  const candidate: FaqCandidate = {
    topicId: topic,
    question: canonical.question,
    answer: canonical.answer,
    confidence: classifications[0].confidence,
    sourceConversations: samples.map(s => s.convId),
    extractedAt: new Date().toISOString(),
    threadLength: avgThreadLength,
    qualityScore: Math.max(0, qualityScore),
  }
  
  console.log(`  ✅ Generated candidate: "${canonical.question.slice(0, 60)}..."`)
  
  return [candidate]
}

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const singleTopic = args.includes('--topic') ? args[args.indexOf('--topic') + 1] : null
  
  console.log('=== FAQ Extraction from LLM Topics ===')
  console.log(`Dry run: ${dryRun}`)
  if (singleTopic) console.log(`Single topic: ${singleTopic}`)
  
  // Load progress for resumability
  const progress = loadProgress()
  console.log(`Previously completed: ${progress.completedTopics.length} topics`)
  
  // Load and group classifications
  const classifications = loadClassifications()
  const byTopic = groupByTopic(classifications)
  
  console.log(`\nTopics to process: ${byTopic.size}`)
  console.log(`Skipping topics: ${Array.from(SKIP_TOPICS).join(', ')}`)
  console.log(`Min topic size: ${MIN_TOPIC_SIZE}`)
  console.log(`Min confidence: ${MIN_CONFIDENCE}`)
  
  // Sort topics by size (process largest first)
  const sortedTopics = Array.from(byTopic.entries())
    .filter(([topic, items]) => items.length >= MIN_TOPIC_SIZE)
    .sort((a, b) => b[1].length - a[1].length)
  
  console.log(`\nEligible topics: ${sortedTopics.length}`)
  
  let totalCandidates = 0
  let processedTopics = 0
  
  for (const [topic, items] of sortedTopics) {
    // Skip if single topic mode and not matching
    if (singleTopic && topic !== singleTopic) continue
    
    // Skip already completed topics
    if (progress.completedTopics.includes(topic)) {
      console.log(`Skipping ${topic} (already completed)`)
      continue
    }
    
    const candidates = await extractTopicCandidates(topic, items)
    
    if (!dryRun && candidates.length > 0) {
      // Append to JSONL
      for (const candidate of candidates) {
        appendFileSync(OUTPUT_PATH, JSON.stringify(candidate) + '\n')
      }
      totalCandidates += candidates.length
    }
    
    // Mark topic as complete
    if (!dryRun) {
      progress.completedTopics.push(topic)
      saveProgress(progress)
    }
    
    processedTopics++
    
    // Rate limit
    await new Promise(r => setTimeout(r, 200))
  }
  
  console.log(`\n=== Complete ===`)
  console.log(`Topics processed: ${processedTopics}`)
  console.log(`Candidates generated: ${totalCandidates}`)
  console.log(`Output: ${OUTPUT_PATH}`)
}

main().catch(console.error)
