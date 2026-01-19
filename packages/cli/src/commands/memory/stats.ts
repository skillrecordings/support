import { calculateConfidence } from '@skillrecordings/memory/decay'
import { VotingService } from '@skillrecordings/memory/voting'

/**
 * Display memory statistics
 */
export async function stats(options: {
  collection?: string
  app?: string
  json?: boolean
}): Promise<void> {
  try {
    const statsResult = await VotingService.stats(options.collection)

    if (options.json) {
      console.log(JSON.stringify(statsResult, null, 2))
      return
    }

    // Format output
    const collections = Object.keys(statsResult)

    if (collections.length === 0) {
      console.log('No memories found')
      return
    }

    console.log('\nMemory Statistics')
    console.log('─'.repeat(60))

    for (const collection of collections) {
      const stats = statsResult[collection]
      if (!stats) continue

      console.log(`\n${collection}:`)
      console.log(`  Total memories: ${stats.count}`)
      console.log(
        `  Avg confidence: ${(stats.avg_confidence * 100).toFixed(1)}%`
      )
      console.log(`  Upvotes: ${stats.total_upvotes}`)
      console.log(`  Downvotes: ${stats.total_downvotes}`)
      console.log(`  Citations: ${stats.total_citations}`)
      console.log(
        `  Avg success rate: ${(stats.avg_success_rate * 100).toFixed(1)}%`
      )
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

/**
 * List stale memories (low confidence, needing validation)
 */
export async function stale(options: {
  collection?: string
  threshold?: number
  json?: boolean
}): Promise<void> {
  try {
    const threshold = options.threshold ?? 0.25

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

    if (options.json) {
      console.log(JSON.stringify(staleMemories, null, 2))
      return
    }

    if (staleMemories.length === 0) {
      console.log(
        `No stale memories found (threshold: ${(threshold * 100).toFixed(0)}%)`
      )
      return
    }

    console.log(
      `\nStale Memories (confidence < ${(threshold * 100).toFixed(0)}%)`
    )
    console.log('─'.repeat(80))

    for (const mem of staleMemories) {
      console.log(`\n${mem.id} [${mem.collection}]`)
      console.log(`  Confidence: ${(mem.confidence * 100).toFixed(1)}%`)
      console.log(`  Age: ${mem.age_days.toFixed(1)} days`)
      console.log(`  Preview: ${mem.content_preview}`)
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
