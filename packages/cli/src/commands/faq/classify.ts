/**
 * FAQ Topic Classification CLI Command
 *
 * Classifies conversations from parquet into taxonomy topics using Claude Haiku.
 * Resumable - appends to JSONL and skips already-classified conversations.
 *
 * Usage:
 *   bun src/index.ts faq classify
 *   bun src/index.ts faq classify --batch-size 50
 *   bun src/index.ts faq classify --dry-run
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { generateObject } from 'ai'
import type { Command } from 'commander'
import { z } from 'zod'
import { type CommandContext, createContext } from '../../core/context'
import { CLIError, formatError } from '../../core/errors'

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

const handleFaqClassifyError = (
  ctx: CommandContext,
  error: unknown,
  message: string,
  suggestion = 'Verify inputs and try again.'
): void => {
  const cliError =
    error instanceof CLIError
      ? error
      : new CLIError({
          userMessage: message,
          suggestion,
          cause: error,
        })

  ctx.output.error(formatError(cliError))
  process.exitCode = cliError.exitCode
}

function createProgressReporter(
  ctx: CommandContext,
  total: number
): {
  update: (completed: number) => void
  done: (completed: number) => void
} {
  const startTime = Date.now()
  return {
    update(completed: number) {
      const percent = total > 0 ? Math.round((completed / total) * 100) : 0
      ctx.output.progress(`Classified ${completed}/${total} (${percent}%)`)
    },
    done(completed: number) {
      const elapsedMs = Date.now() - startTime
      const rate = elapsedMs > 0 ? completed / (elapsedMs / 1000) : 0
      ctx.output.message(
        `Completed ${completed} classifications in ${formatETA(elapsedMs)} (${rate.toFixed(1)}/s)`
      )
    },
  }
}

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
  ctx: CommandContext,
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
        ctx.output.warn(
          `Failed: ${conv.conversation_id}: ${String(result.reason)}`
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

// ============================================================================
// Main Command Handler
// ============================================================================

export async function faqClassify(
  ctx: CommandContext,
  options: {
    parquetPath?: string
    taxonomyPath?: string
    outputPath?: string
    batchSize?: number
    dryRun?: boolean
  }
): Promise<void> {
  const parquetPath = options.parquetPath ?? DEFAULT_PARQUET_PATH
  const taxonomyPath = options.taxonomyPath ?? DEFAULT_TAXONOMY_PATH
  const outputPath = options.outputPath ?? DEFAULT_OUTPUT_PATH
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE
  const outputJson = ctx.format === 'json'

  if (!outputJson) {
    ctx.output.data('🏷️  FAQ Topic Classification Pipeline')
    ctx.output.data('='.repeat(60))
    ctx.output.data(`   Parquet source: ${parquetPath}`)
    ctx.output.data(`   Taxonomy:       ${taxonomyPath}`)
    ctx.output.data(`   Output:         ${outputPath}`)
    ctx.output.data(`   Batch size:     ${batchSize}`)
    ctx.output.data(`   Concurrency:    ${CONCURRENT_LIMIT}`)
    ctx.output.data(`   Dry run:        ${options.dryRun ?? false}`)
    ctx.output.data('')
  }

  // Validate inputs exist
  if (!existsSync(parquetPath)) {
    handleFaqClassifyError(
      ctx,
      new CLIError({
        userMessage: `Parquet file not found: ${parquetPath}.`,
        suggestion: 'Verify the parquet path and try again.',
      }),
      'Parquet file not found.'
    )
    return
  }
  if (!existsSync(taxonomyPath)) {
    handleFaqClassifyError(
      ctx,
      new CLIError({
        userMessage: `Taxonomy file not found: ${taxonomyPath}.`,
        suggestion: 'Verify the taxonomy path and try again.',
      }),
      'Taxonomy file not found.'
    )
    return
  }

  // Ensure output directory exists
  const outputDir = dirname(outputPath)
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true })
  }

  // Load taxonomy
  if (!outputJson) ctx.output.data('📚 Loading taxonomy...')
  const taxonomy: Taxonomy = JSON.parse(readFileSync(taxonomyPath, 'utf-8'))
  const validTopicIds = new Set(taxonomy.topics.map((t) => t.id))
  validTopicIds.add('unknown')
  if (!outputJson) {
    ctx.output.data(`   Found ${taxonomy.topics.length} topics`)
  }

  // Load conversations from parquet
  if (!outputJson) ctx.output.data('\n📦 Loading conversations from parquet...')
  const allConversations = await loadConversationsFromParquet(parquetPath)
  if (!outputJson) {
    ctx.output.data(`   Found ${allConversations.length} conversations`)
  }

  // Load existing classifications for resume
  if (!outputJson) {
    ctx.output.data('\n🔍 Checking for existing classifications...')
  }
  const classifiedIds = loadExistingClassifications(outputPath)
  if (!outputJson) {
    ctx.output.data(`   Already classified: ${classifiedIds.size}`)
  }

  // Filter to unclassified conversations
  const remaining = allConversations.filter(
    (c) => !classifiedIds.has(c.conversation_id)
  )
  if (!outputJson) {
    ctx.output.data(`   Remaining to classify: ${remaining.length}`)
  }

  if (remaining.length === 0) {
    if (outputJson) {
      ctx.output.data({
        success: true,
        total: allConversations.length,
        alreadyClassified: classifiedIds.size,
        remaining: 0,
        outputPath,
      })
    } else {
      ctx.output.data('\n✅ All conversations already classified!')
    }
    return
  }

  if (options.dryRun) {
    if (!outputJson) {
      ctx.output.data('\n🧪 Dry run - showing sample classifications:')
    }
    const systemPrompt = buildClassifyPrompt(taxonomy)
    const sample = remaining.slice(0, 3)
    const samples: Array<{
      conversationId: string
      topicId?: string
      confidence?: number
      messagePreview?: string
      error?: string
    }> = []
    for (const conv of sample) {
      try {
        const result = await classifyConversation(
          conv,
          systemPrompt,
          validTopicIds
        )
        if (!outputJson) {
          ctx.output.data(`\n   ${conv.conversation_id}:`)
          ctx.output.data(
            `     Topic: ${result.topicId} (${(result.confidence * 100).toFixed(0)}%)`
          )
          ctx.output.data(
            `     Message: "${conv.first_message.slice(0, 100)}..."`
          )
        } else {
          samples.push({
            conversationId: conv.conversation_id,
            topicId: result.topicId,
            confidence: result.confidence,
            messagePreview: conv.first_message.slice(0, 100),
          })
        }
      } catch (error) {
        if (!outputJson) {
          ctx.output.warn(`   ❌ ${conv.conversation_id}: ${String(error)}`)
        } else {
          samples.push({
            conversationId: conv.conversation_id,
            error: String(error),
          })
        }
      }
    }
    if (outputJson) {
      ctx.output.data({
        success: true,
        dryRun: true,
        total: allConversations.length,
        alreadyClassified: classifiedIds.size,
        remaining: remaining.length,
        samples,
      })
    } else {
      ctx.output.data('\n🧪 Dry run complete - no classifications saved')
    }
    return
  }

  // Build prompt once
  const systemPrompt = buildClassifyPrompt(taxonomy)

  // Process in batches
  if (!outputJson) ctx.output.data('\n🚀 Starting classification...')
  const progress = createProgressReporter(ctx, remaining.length)
  let totalSuccess = 0
  let totalFailed = 0

  for (let i = 0; i < remaining.length; i += batchSize) {
    const batch = remaining.slice(i, i + batchSize)
    const { success, failed } = await processBatch(
      batch,
      systemPrompt,
      validTopicIds,
      outputPath,
      ctx,
      (completed) => progress.update(i + completed)
    )
    totalSuccess += success
    totalFailed += failed

    // Update progress after batch
    progress.update(i + batch.length)
  }

  progress.done(totalSuccess + totalFailed)

  // Summary
  if (outputJson) {
    ctx.output.data({
      success: true,
      total: totalSuccess + totalFailed,
      successful: totalSuccess,
      failed: totalFailed,
      outputPath,
    })
  } else {
    ctx.output.data('\n📊 Classification Summary:')
    ctx.output.data(`   ✅ Successful: ${totalSuccess}`)
    ctx.output.data(`   ❌ Failed:     ${totalFailed}`)
    ctx.output.data(`   📁 Output:     ${outputPath}`)
  }
}

// ============================================================================
// Command Registration
// ============================================================================

export function registerFaqClassifyCommands(program: Command): void {
  program
    .command('classify')
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
    .action(async (opts, command) => {
      const globalOpts =
        typeof command.optsWithGlobals === 'function'
          ? command.optsWithGlobals()
          : {
              ...command.parent?.opts(),
              ...command.opts(),
            }
      const ctx = await createContext({
        format: globalOpts.format,
        verbose: globalOpts.verbose,
        quiet: globalOpts.quiet,
      })
      await faqClassify(ctx, {
        ...opts,
        batchSize: opts.batchSize ? parseInt(opts.batchSize, 10) : undefined,
      })
    })
}
