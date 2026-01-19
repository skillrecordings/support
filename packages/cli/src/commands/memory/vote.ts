import { MemoryService } from '@skillrecordings/memory/memory'
import { VotingService } from '@skillrecordings/memory/voting'

/**
 * Validate a memory (resets decay clock)
 */
export async function validate(
  id: string,
  options: {
    collection?: string
    json?: boolean
  }
): Promise<void> {
  try {
    const collection = options.collection || 'learnings'
    await MemoryService.validate(id, collection)

    if (options.json) {
      console.log(JSON.stringify({ success: true, id }, null, 2))
    } else {
      console.log(`✓ Validated memory: ${id}`)
      console.log('  Decay clock has been reset')
    }
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
 * Upvote a memory
 */
export async function upvote(
  id: string,
  options: {
    collection?: string
    reason?: string
    json?: boolean
  }
): Promise<void> {
  try {
    const collection = options.collection || 'learnings'
    await VotingService.vote(id, collection, 'upvote')

    if (options.json) {
      console.log(
        JSON.stringify({ success: true, id, vote: 'upvote' }, null, 2)
      )
    } else {
      console.log(`✓ Upvoted memory: ${id}`)
      if (options.reason) {
        console.log(`  Reason: ${options.reason}`)
      }
    }
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
 * Downvote a memory
 */
export async function downvote(
  id: string,
  options: {
    collection?: string
    reason?: string
    json?: boolean
  }
): Promise<void> {
  try {
    const collection = options.collection || 'learnings'
    await VotingService.vote(id, collection, 'downvote')

    if (options.json) {
      console.log(
        JSON.stringify({ success: true, id, vote: 'downvote' }, null, 2)
      )
    } else {
      console.log(`✓ Downvoted memory: ${id}`)
      if (options.reason) {
        console.log(`  Reason: ${options.reason}`)
      }
    }
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
 * Delete a memory
 */
export async function deleteMemory(
  id: string,
  options: {
    collection?: string
    json?: boolean
  }
): Promise<void> {
  try {
    const collection = options.collection || 'learnings'
    await MemoryService.delete(id, collection)

    if (options.json) {
      console.log(JSON.stringify({ success: true, id }, null, 2))
    } else {
      console.log(`✓ Deleted memory: ${id}`)
    }
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
