import { MemoryService } from '@skillrecordings/memory/memory'
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
 * Validate a memory (resets decay clock)
 */
export async function validate(
  ctx: CommandContext,
  id: string,
  options: {
    collection?: string
    json?: boolean
  }
): Promise<void> {
  const outputJson = options.json === true || ctx.format === 'json'

  try {
    const collection = options.collection || 'learnings'
    await MemoryService.validate(id, collection)

    if (outputJson) {
      ctx.output.data({ success: true, id })
      return
    }

    ctx.output.data(`✓ Validated memory: ${id}`)
    ctx.output.data('  Decay clock has been reset')
  } catch (error) {
    handleMemoryError(ctx, error, 'Failed to validate memory.')
  }
}

/**
 * Upvote a memory
 */
export async function upvote(
  ctx: CommandContext,
  id: string,
  options: {
    collection?: string
    reason?: string
    json?: boolean
  }
): Promise<void> {
  const outputJson = options.json === true || ctx.format === 'json'

  try {
    const collection = options.collection || 'learnings'
    await VotingService.vote(id, collection, 'upvote')

    if (outputJson) {
      ctx.output.data({ success: true, id, vote: 'upvote' })
      return
    }

    ctx.output.data(`✓ Upvoted memory: ${id}`)
    if (options.reason) {
      ctx.output.data(`  Reason: ${options.reason}`)
    }
  } catch (error) {
    handleMemoryError(ctx, error, 'Failed to upvote memory.')
  }
}

/**
 * Downvote a memory
 */
export async function downvote(
  ctx: CommandContext,
  id: string,
  options: {
    collection?: string
    reason?: string
    json?: boolean
  }
): Promise<void> {
  const outputJson = options.json === true || ctx.format === 'json'

  try {
    const collection = options.collection || 'learnings'
    await VotingService.vote(id, collection, 'downvote')

    if (outputJson) {
      ctx.output.data({ success: true, id, vote: 'downvote' })
      return
    }

    ctx.output.data(`✓ Downvoted memory: ${id}`)
    if (options.reason) {
      ctx.output.data(`  Reason: ${options.reason}`)
    }
  } catch (error) {
    handleMemoryError(ctx, error, 'Failed to downvote memory.')
  }
}

/**
 * Delete a memory
 */
export async function deleteMemory(
  ctx: CommandContext,
  id: string,
  options: {
    collection?: string
    json?: boolean
  }
): Promise<void> {
  const outputJson = options.json === true || ctx.format === 'json'

  try {
    const collection = options.collection || 'learnings'
    await MemoryService.delete(id, collection)

    if (outputJson) {
      ctx.output.data({ success: true, id })
      return
    }

    ctx.output.data(`✓ Deleted memory: ${id}`)
  } catch (error) {
    handleMemoryError(ctx, error, 'Failed to delete memory.')
  }
}
