import { calculateConfidence } from '@skillrecordings/memory/decay'
import { MemoryService } from '@skillrecordings/memory/memory'
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
 * Pad string to fixed width
 */
function pad(str: string, width: number): string {
  return str.padEnd(width).slice(0, width)
}

/**
 * Format confidence score as percentage
 */
function formatConfidence(confidence: number): string {
  return `${(confidence * 100).toFixed(0)}%`
}

/**
 * Find memories by semantic search
 */
export async function find(
  ctx: CommandContext,
  query: string,
  options: {
    limit?: string
    collection?: string
    app?: string
    minConfidence?: string
    json?: boolean
  }
): Promise<void> {
  const outputJson = options.json === true || ctx.format === 'json'

  try {
    const limit = options.limit ? parseInt(options.limit, 10) : 10
    const threshold = options.minConfidence
      ? parseFloat(options.minConfidence)
      : 0.5

    if (limit < 1 || limit > 100 || Number.isNaN(limit)) {
      throw new CLIError({
        userMessage: '--limit must be between 1 and 100.',
        suggestion: 'Choose a value between 1 and 100 (default: 10).',
      })
    }

    if (threshold < 0 || threshold > 1 || Number.isNaN(threshold)) {
      throw new CLIError({
        userMessage: '--min-confidence must be between 0 and 1.',
        suggestion: 'Choose a value between 0 and 1 (default: 0.5).',
      })
    }

    const results = await MemoryService.find(query, {
      collection: options.collection || 'learnings',
      limit,
      threshold,
      app_slug: options.app,
    })

    if (outputJson) {
      ctx.output.data(results)
      return
    }

    if (results.length === 0) {
      ctx.output.data('No memories found.')
      return
    }

    ctx.output.data(`\nFound ${results.length} memories:\n`)
    ctx.output.data(
      pad('ID', 36) +
        ' ' +
        pad('SCORE', 8) +
        ' ' +
        pad('CONF', 6) +
        ' ' +
        pad('AGE', 8) +
        ' ' +
        'CONTENT'
    )
    ctx.output.data('-'.repeat(100))

    for (const result of results) {
      const confidence = calculateConfidence(result.memory)
      const ageDays = Math.floor(result.age_days)
      const ageStr =
        ageDays === 0 ? 'today' : ageDays === 1 ? '1 day' : `${ageDays} days`

      const contentPreview =
        result.memory.content.length > 40
          ? result.memory.content.slice(0, 37) + '...'
          : result.memory.content

      ctx.output.data(
        pad(result.memory.id, 36) +
          ' ' +
          pad(result.score.toFixed(2), 8) +
          ' ' +
          pad(formatConfidence(confidence), 6) +
          ' ' +
          pad(ageStr, 8) +
          ' ' +
          contentPreview
      )

      if (
        result.memory.metadata.tags &&
        result.memory.metadata.tags.length > 0
      ) {
        ctx.output.data(
          pad('', 36) +
            ' ' +
            pad('', 8) +
            ' ' +
            pad('', 6) +
            ' ' +
            pad('', 8) +
            ' ' +
            `Tags: ${result.memory.metadata.tags.join(', ')}`
        )
      }
    }

    ctx.output.data('')
  } catch (error) {
    handleMemoryError(ctx, error, 'Failed to search memories.')
  }
}
