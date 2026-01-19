import { calculateConfidence } from '@skillrecordings/memory/decay'
import { MemoryService } from '@skillrecordings/memory/memory'

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
  query: string,
  options: {
    limit?: string
    collection?: string
    app?: string
    minConfidence?: string
    json?: boolean
  }
): Promise<void> {
  try {
    const limit = options.limit ? parseInt(options.limit, 10) : 10
    const threshold = options.minConfidence
      ? parseFloat(options.minConfidence)
      : 0.5

    if (limit < 1 || limit > 100) {
      console.error('Error: --limit must be between 1 and 100')
      process.exit(1)
    }

    if (threshold < 0 || threshold > 1) {
      console.error('Error: --min-confidence must be between 0 and 1')
      process.exit(1)
    }

    const results = await MemoryService.find(query, {
      collection: options.collection || 'learnings',
      limit,
      threshold,
      app_slug: options.app,
    })

    if (options.json) {
      console.log(JSON.stringify(results, null, 2))
      return
    }

    if (results.length === 0) {
      console.log('No memories found.')
      return
    }

    console.log(`\nFound ${results.length} memories:\n`)
    console.log(
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
    console.log('-'.repeat(100))

    for (const result of results) {
      const confidence = calculateConfidence(result.memory)
      const ageDays = Math.floor(result.age_days)
      const ageStr =
        ageDays === 0 ? 'today' : ageDays === 1 ? '1 day' : `${ageDays} days`

      const contentPreview =
        result.memory.content.length > 40
          ? result.memory.content.slice(0, 37) + '...'
          : result.memory.content

      console.log(
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
        console.log(
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

    console.log('')
  } catch (error) {
    if (options.json) {
      console.error(
        JSON.stringify({
          error: error instanceof Error ? error.message : 'Unknown error',
        })
      )
    } else {
      console.error(
        'Error:',
        error instanceof Error ? error.message : 'Unknown error'
      )
    }
    process.exit(1)
  }
}
