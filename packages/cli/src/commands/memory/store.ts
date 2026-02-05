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
 * Store a new memory with optional tags and collection
 */
export async function store(
  ctx: CommandContext,
  content: string,
  options: {
    tags?: string
    collection?: string
    app?: string
    json?: boolean
  }
): Promise<void> {
  const outputJson = options.json === true || ctx.format === 'json'

  try {
    const memory = await MemoryService.store(content, {
      collection: options.collection || 'learnings',
      source: 'human',
      app_slug: options.app,
      tags: options.tags?.split(',').map((t) => t.trim()) ?? [],
    })

    if (outputJson) {
      ctx.output.data(memory)
      return
    }

    ctx.output.data(`✓ Stored memory: ${memory.id}`)
    if (memory.metadata.tags && memory.metadata.tags.length > 0) {
      ctx.output.data(`  Tags: ${memory.metadata.tags.join(', ')}`)
    }
    if (memory.metadata.app_slug) {
      ctx.output.data(`  App: ${memory.metadata.app_slug}`)
    }
  } catch (error) {
    handleMemoryError(ctx, error, 'Failed to store memory.')
  }
}
