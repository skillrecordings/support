/**
 * FAQ Topic Classification CLI Command
 *
 * Classifies conversations from parquet into taxonomy topics using Claude Haiku.
 * Resumable - appends to JSONL and skips already-classified conversations.
 *
 * Usage:
 *   bun src/index.ts faq-classify
 *   bun src/index.ts faq-classify --batch-size 50
 *   bun src/index.ts faq-classify --dry-run
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { generateObject } from 'ai'
import type { Command } from 'commander'
import { z } from 'zod'

/** Default paths relative to project root */
const PROJECT_ROOT = resolve(__dirname, '../../../..')
const DEFAULT_PARQUET_PATH = join(
  PROJECT_ROOT,
  'artifacts/phase-0/embeddings/v2/conversations.parquet'
)
const DEFAULT_TAXONOMY_PATH = join(
  PROJECT_ROOT,
  'artifacts/phase-1/llm-topics/taxonomy.json'
)
const DEFAULT_OUTPUT_PATH = join(
  PROJECT_ROOT,
  'artifacts/phase-1/llm-topics/classifications.jsonl'
)

/** Rate limiting configuration */
const DEFAULT_BATCH_SIZE = 100
const CONCURRENT_LIMIT = 10
const DELAY_BETWEEN_BATCHES_MS = 100

/** Model for classification */
const MODEL = 'anthropic/claude-haiku-4-5'

// ============================================================================
// Types
// ============================================================================

interface Topic {
  id: string
  name: string
  description: string
  examples: string[]
}

interface Taxonomy {
  version: string
  generatedAt: string
  model: string
  topics: Topic[]
}

interface Conversation {
  conversation_id: string
  first_message: string
  inbox_id?: string
  tags?: string[]
  token_count?: number
}

interface Classification {
  conversationId: string
  topicId: string
  confidence: number
  timestamp: string
}

// ============================================================================
// DuckDB Loader (via CLI for reliability)
// ============================================================================

async function loadConversationsFromParquet(
  parquetPath: string
): Promise<Conversation[]> {
  const { execSync } = await import('child_process')

  const query = `
    SELECT 
      conversation_id,
      first_message,
      inbox_id,
      token_count
    FROM read_parquet('${parquetPath}')
    WHERE first_message IS NOT NULL
    ORDER BY conversation_id
  `

  // Use DuckDB CLI with JSON output
  const result = execSync(`duckdb -json -c "${query.replace(/"/g, '\\"')}"`, {
    encoding: 'utf-8',
    maxBuffer: 100 * 1024 * 1024, // 100MB buffer for large datasets
  })

  const rows = JSON.parse(result) as Conversation[]
  return rows
}

// ============================================================================
// JSONL Resume Support
// ============================================================================

function loadExistingClassifications(outputPath: string): Set<string> {
  const classifiedIds = new Set<string>()

  if (!existsSync(outputPath)) {
    return classifiedIds
  }

  const content = readFileSync(outputPath, 'utf-8')
  const lines = content.split('\n').filter((line) => line.trim())

  for (const line of lines) {
    try {
      const classification = JSON.parse(line) as Classification
      classifiedIds.add(classification.conversationId)
    } catch {
      // Skip malformed lines
    }
  }

  return classifiedIds
}

function appendClassification(
  outputPath: string,
  classification: Classification
): void {
  appendFileSync(outputPath, JSON.stringify(classification) + '\n')
}

// ============================================================================
// LLM Classification
// ============================================================================

const classifySchema = z.object({
  topicId: z.string(),
  confidence: z.number().min(0).max(1),
})

function buildClassifyPrompt(taxonomy: Taxonomy): string {
  const topicList = taxonomy.topics
    .map((t) => {
      const exampleText = t.examples.slice(0, 2).join('; ')
      return `- ${t.id}: ${t.description} (e.g., "${exampleText}")`
    })
    .join('\n')

  return `You are a support ticket classifier. Classify the customer's message into exactly ONE of these topics:

${topicList}

Rules:
- Choose the MOST specific matching topic
- If the message fits multiple topics, pick the primary intent
- Use "unknown" only if genuinely ambiguous (set topicId to "unknown")
- Confidence should be 0.5-1.0 based on how clear the match is

Output the topic ID and confidence.`
}

async function classifyConversation(
  conversation: Conversation,
  systemPrompt: string,
  validTopicIds: Set<string>
): Promise<Classification> {
  const { object } = await generateObject({
    model: MODEL,
    schema: classifySchema,
    system: systemPrompt,
    prompt: conversation.first_message.slice(0, 2000), // Truncate long messages
  })

  // Validate topic ID exists in taxonomy
  const topicId = validTopicIds.has(object.topicId) ? object.topicId : 'unknown'

  return {
    conversationId: conversation.conversation_id,
    topicId,
    confidence: object.confidence,
    timestamp: new Date().toISOString(),
  }
}

// ============================================================================
// Batch Processing with Rate Limiting
// ============================================================================

async function processBatch(
  conversations: Conversation[],
  systemPrompt: string,
  validTopicIds: Set<string>,
  outputPath: string,
  onProgress: (completed: number) => void
): Promise<{ success: number; failed: number }> {
  let success = 0
  let failed = 0

  // Process in chunks of CONCURRENT_LIMIT
  for (let i = 0; i < conversations.length; i += CONCURRENT_LIMIT) {
    const chunk = conversations.slice(i, i + CONCURRENT_LIMIT)

    const results = await Promise.allSettled(
      chunk.map((conv) =>
        classifyConversation(conv, systemPrompt, validTopicIds)
      )
    )

    for (let j = 0; j < results.length; j++) {
      const result = results[j]!
      const conv = chunk[j]!

      if (result.status === 'fulfilled') {
        appendClassification(outputPath, result.value)
        success++
      } else {
        // Log failed classification as error
        const fallback: Classification = {
          conversationId: conv.conversation_id,
          topicId: 'error',
          confidence: 0,
          timestamp: new Date().toISOString(),
        }
        appendClassification(outputPath, fallback)
        failed++
        console.error(
          `\n  ❌ Failed: ${conv.conversation_id}: ${result.reason}`
        )
      }
      onProgress(success + failed)
    }

    // Rate limit between chunks
    if (i + CONCURRENT_LIMIT < conversations.length) {
      await new Promise((r) => setTimeout(r, DELAY_BETWEEN_BATCHES_MS))
    }
  }

  return { success, failed }
}

// ============================================================================
// Progress Display
// ============================================================================

function formatETA(remainingMs: number): string {
  if (remainingMs < 0 || !isFinite(remainingMs)) return '--:--'
  const seconds = Math.floor(remainingMs / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`
  }
  return `${minutes}m ${seconds % 60}s`
}

function createProgressBar(total: number): {
  update: (completed: number) => void
  done: () => void
} {
  const startTime = Date.now()
  let lastCompleted = 0

  return {
    update(completed: number) {
      lastCompleted = completed
      const percent = Math.round((completed / total) * 100)
      const elapsed = Date.now() - startTime
      const rate = completed / (elapsed / 1000)
      const remaining = (total - completed) / rate
      const eta = formatETA(remaining * 1000)

      const barWidth = 30
      const filledWidth = Math.round((completed / total) * barWidth)
      const bar = '█'.repeat(filledWidth) + '░'.repeat(barWidth - filledWidth)

      process.stdout.write(
        `\r  [${bar}] ${completed}/${total} (${percent}%) | ${rate.toFixed(1)}/s | ETA: ${eta}  `
      )
    },
    done() {
      const elapsed = Date.now() - startTime
      const rate = lastCompleted / (elapsed / 1000)
      console.log(
        `\n  ✅ Completed ${lastCompleted} classifications in ${formatETA(elapsed)} (${rate.toFixed(1)}/s)`
      )
    },
  }
}

// ============================================================================
// Main Command Handler
// ============================================================================

async function faqClassify(options: {
  parquetPath?: string
  taxonomyPath?: string
  outputPath?: string
  batchSize?: number
  dryRun?: boolean
}): Promise<void> {
  const parquetPath = options.parquetPath ?? DEFAULT_PARQUET_PATH
  const taxonomyPath = options.taxonomyPath ?? DEFAULT_TAXONOMY_PATH
  const outputPath = options.outputPath ?? DEFAULT_OUTPUT_PATH
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE

  console.log('🏷️  FAQ Topic Classification Pipeline')
  console.log('='.repeat(60))
  console.log(`   Parquet source: ${parquetPath}`)
  console.log(`   Taxonomy:       ${taxonomyPath}`)
  console.log(`   Output:         ${outputPath}`)
  console.log(`   Batch size:     ${batchSize}`)
  console.log(`   Concurrency:    ${CONCURRENT_LIMIT}`)
  console.log(`   Dry run:        ${options.dryRun ?? false}`)
  console.log('')

  // Validate inputs exist
  if (!existsSync(parquetPath)) {
    console.error(`❌ Parquet file not found: ${parquetPath}`)
    process.exit(1)
  }
  if (!existsSync(taxonomyPath)) {
    console.error(`❌ Taxonomy file not found: ${taxonomyPath}`)
    process.exit(1)
  }

  // Ensure output directory exists
  const outputDir = dirname(outputPath)
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true })
  }

  // Load taxonomy
  console.log('📚 Loading taxonomy...')
  const taxonomy: Taxonomy = JSON.parse(readFileSync(taxonomyPath, 'utf-8'))
  const validTopicIds = new Set(taxonomy.topics.map((t) => t.id))
  validTopicIds.add('unknown')
  console.log(`   Found ${taxonomy.topics.length} topics`)

  // Load conversations from parquet
  console.log('\n📦 Loading conversations from parquet...')
  const allConversations = await loadConversationsFromParquet(parquetPath)
  console.log(`   Found ${allConversations.length} conversations`)

  // Load existing classifications for resume
  console.log('\n🔍 Checking for existing classifications...')
  const classifiedIds = loadExistingClassifications(outputPath)
  console.log(`   Already classified: ${classifiedIds.size}`)

  // Filter to unclassified conversations
  const remaining = allConversations.filter(
    (c) => !classifiedIds.has(c.conversation_id)
  )
  console.log(`   Remaining to classify: ${remaining.length}`)

  if (remaining.length === 0) {
    console.log('\n✅ All conversations already classified!')
    return
  }

  if (options.dryRun) {
    console.log('\n🧪 Dry run - showing sample classifications:')
    const systemPrompt = buildClassifyPrompt(taxonomy)
    const sample = remaining.slice(0, 3)
    for (const conv of sample) {
      try {
        const result = await classifyConversation(
          conv,
          systemPrompt,
          validTopicIds
        )
        console.log(`\n   ${conv.conversation_id}:`)
        console.log(
          `     Topic: ${result.topicId} (${(result.confidence * 100).toFixed(0)}%)`
        )
        console.log(`     Message: "${conv.first_message.slice(0, 100)}..."`)
      } catch (error) {
        console.log(`   ❌ ${conv.conversation_id}: ${error}`)
      }
    }
    console.log('\n🧪 Dry run complete - no classifications saved')
    return
  }

  // Build prompt once
  const systemPrompt = buildClassifyPrompt(taxonomy)

  // Process in batches
  console.log('\n🚀 Starting classification...')
  const progress = createProgressBar(remaining.length)
  let totalSuccess = 0
  let totalFailed = 0

  for (let i = 0; i < remaining.length; i += batchSize) {
    const batch = remaining.slice(i, i + batchSize)
    const { success, failed } = await processBatch(
      batch,
      systemPrompt,
      validTopicIds,
      outputPath,
      (completed) => progress.update(i + completed)
    )
    totalSuccess += success
    totalFailed += failed

    // Update progress after batch
    progress.update(i + batch.length)
  }

  progress.done()

  // Summary
  console.log('\n📊 Classification Summary:')
  console.log(`   ✅ Successful: ${totalSuccess}`)
  console.log(`   ❌ Failed:     ${totalFailed}`)
  console.log(`   📁 Output:     ${outputPath}`)
}

// ============================================================================
// Command Registration
// ============================================================================

export function registerFaqClassifyCommands(program: Command): void {
  program
    .command('faq-classify')
    .description('Classify conversations into FAQ topics using LLM')
    .option(
      '--parquet-path <path>',
      'Path to conversations parquet file',
      DEFAULT_PARQUET_PATH
    )
    .option(
      '--taxonomy-path <path>',
      'Path to taxonomy JSON file',
      DEFAULT_TAXONOMY_PATH
    )
    .option(
      '--output-path <path>',
      'Path to output JSONL file',
      DEFAULT_OUTPUT_PATH
    )
    .option(
      '--batch-size <number>',
      'Conversations per batch',
      String(DEFAULT_BATCH_SIZE)
    )
    .option('-d, --dry-run', 'Show sample classifications without saving')
    .action((opts) => {
      faqClassify({
        ...opts,
        batchSize: opts.batchSize ? parseInt(opts.batchSize, 10) : undefined,
      })
    })
}
