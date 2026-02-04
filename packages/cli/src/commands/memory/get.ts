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
 * Get a specific memory by ID
 */
export async function get(
  ctx: CommandContext,
  id: string,
  options: {
    collection?: string
    json?: boolean
  }
): Promise<void> {
  const outputJson = options.json === true || ctx.format === 'json'

  try {
    const memory = await MemoryService.get(
      id,
      options.collection || 'learnings'
    )

    if (!memory) {
      throw new CLIError({
        userMessage: 'Memory not found.',
        suggestion: 'Verify the memory ID and collection.',
      })
    }

    if (outputJson) {
      ctx.output.data(memory)
      return
    }

    const confidence = calculateConfidence(memory)
    const createdAt = new Date(memory.metadata.created_at)
    const lastValidated = memory.metadata.last_validated_at
      ? new Date(memory.metadata.last_validated_at)
      : null

    ctx.output.data('\n📋 Memory Details:')
    ctx.output.data(`   ID:         ${memory.id}`)
    ctx.output.data(`   Collection: ${memory.metadata.collection}`)
    ctx.output.data(`   Source:     ${memory.metadata.source}`)
    ctx.output.data(`   Confidence: ${(confidence * 100).toFixed(0)}%`)
    ctx.output.data(`   Created:    ${createdAt.toLocaleString()}`)
    if (lastValidated) {
      ctx.output.data(`   Validated:  ${lastValidated.toLocaleString()}`)
    }

    if (memory.metadata.app_slug) {
      ctx.output.data(`   App:        ${memory.metadata.app_slug}`)
    }

    if (memory.metadata.tags && memory.metadata.tags.length > 0) {
      ctx.output.data(`   Tags:       ${memory.metadata.tags.join(', ')}`)
    }

    ctx.output.data('\n📝 Content:')
    ctx.output.data(`   ${memory.content}\n`)

    if (memory.metadata.votes) {
      const { upvotes, downvotes, citations, success_rate } =
        memory.metadata.votes
      if (upvotes > 0 || downvotes > 0 || citations > 0) {
        ctx.output.data('📊 Votes:')
        ctx.output.data(`   Upvotes:      ${upvotes}`)
        ctx.output.data(`   Downvotes:    ${downvotes}`)
        ctx.output.data(`   Citations:    ${citations}`)
        ctx.output.data(
          `   Success Rate: ${(success_rate * 100).toFixed(0)}%\n`
        )
      }
    }
  } catch (error) {
    handleMemoryError(ctx, error, 'Failed to fetch memory.')
  }
}
