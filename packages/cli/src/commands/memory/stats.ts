import { calculateConfidence } from '@skillrecordings/memory/decay'
import { VotingService } from '@skillrecordings/memory/voting'
import { type CommandContext } from '../../core/context'
import { CLIError, formatError } from '../../core/errors'

const handleMemoryError = (
  ctx: CommandContext,
  error: unknown,
  message: string,
  suggestion = 'Verify memory service configuration and try again.'
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

/**
 * Display memory statistics
 */
export async function stats(
  ctx: CommandContext,
  options: {
    collection?: string
    app?: string
    json?: boolean
  }
): Promise<void> {
  const outputJson = options.json === true || ctx.format === 'json'

  try {
    const statsResult = await VotingService.stats(options.collection)

    if (outputJson) {
      ctx.output.data(statsResult)
      return
    }

    // Format output
    const collections = Object.keys(statsResult)

    if (collections.length === 0) {
      ctx.output.data('No memories found')
      return
    }

    ctx.output.data('\nMemory Statistics')
    ctx.output.data('─'.repeat(60))

    for (const collection of collections) {
      const stats = statsResult[collection]
      if (!stats) continue

      ctx.output.data(`\n${collection}:`)
      ctx.output.data(`  Total memories: ${stats.count}`)
      ctx.output.data(
        `  Avg confidence: ${(stats.avg_confidence * 100).toFixed(1)}%`
      )
      ctx.output.data(`  Upvotes: ${stats.total_upvotes}`)
      ctx.output.data(`  Downvotes: ${stats.total_downvotes}`)
      ctx.output.data(`  Citations: ${stats.total_citations}`)
      ctx.output.data(
        `  Avg success rate: ${(stats.avg_success_rate * 100).toFixed(1)}%`
      )
    }

    ctx.output.data('')
  } catch (error) {
    handleMemoryError(ctx, error, 'Failed to fetch memory statistics.')
  }
}

/**
 * List stale memories (low confidence, needing validation)
 */
export async function stale(
  ctx: CommandContext,
  options: {
    collection?: string
    threshold?: number
    json?: boolean
  }
): Promise<void> {
  const outputJson = options.json === true || ctx.format === 'json'

  try {
    const threshold = options.threshold ?? 0.25

    if (threshold < 0 || threshold > 1 || Number.isNaN(threshold)) {
      throw new CLIError({
        userMessage: '--threshold must be between 0 and 1.',
        suggestion: 'Choose a value between 0 and 1 (default: 0.25).',
      })
    }

    // Get all collections or specified one
    const collections = options.collection
      ? [options.collection]
      : await VotingService._listCollections()

    const staleMemories: Array<{
      id: string
      collection: string
      confidence: number
      age_days: number
      content_preview: string
    }> = []

    // Check each collection for stale memories
    for (const collection of collections) {
      const memories = await VotingService._fetchAllMemories(collection)

      for (const memory of memories) {
        const confidence = calculateConfidence(memory)

        if (confidence < threshold) {
          const createdAt = new Date(memory.metadata.created_at)
          const lastValidatedAt = memory.metadata.last_validated_at
            ? new Date(memory.metadata.last_validated_at)
            : undefined
          const referenceDate = lastValidatedAt || createdAt
          const ageDays =
            (Date.now() - referenceDate.getTime()) / (24 * 60 * 60 * 1000)

          // Truncate content for preview
          const contentPreview =
            memory.content.length > 60
              ? memory.content.slice(0, 57) + '...'
              : memory.content

          staleMemories.push({
            id: memory.id,
            collection,
            confidence,
            age_days: ageDays,
            content_preview: contentPreview,
          })
        }
      }
    }

    if (outputJson) {
      ctx.output.data(staleMemories)
      return
    }

    if (staleMemories.length === 0) {
      ctx.output.data(
        `No stale memories found (threshold: ${(threshold * 100).toFixed(0)}%)`
      )
      return
    }

    ctx.output.data(
      `\nStale Memories (confidence < ${(threshold * 100).toFixed(0)}%)`
    )
    ctx.output.data('─'.repeat(80))

    for (const mem of staleMemories) {
      ctx.output.data(`\n${mem.id} [${mem.collection}]`)
      ctx.output.data(`  Confidence: ${(mem.confidence * 100).toFixed(1)}%`)
      ctx.output.data(`  Age: ${mem.age_days.toFixed(1)} days`)
      ctx.output.data(`  Preview: ${mem.content_preview}`)
    }

    ctx.output.data('')
  } catch (error) {
    handleMemoryError(ctx, error, 'Failed to fetch stale memories.')
  }
}
