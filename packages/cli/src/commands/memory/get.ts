import { calculateConfidence } from '@skillrecordings/memory/decay'
import { MemoryService } from '@skillrecordings/memory/memory'

/**
 * Get a specific memory by ID
 */
export async function get(
  id: string,
  options: {
    collection?: string
    json?: boolean
  }
): Promise<void> {
  try {
    const memory = await MemoryService.get(
      id,
      options.collection || 'learnings'
    )

    if (!memory) {
      if (options.json) {
        console.error(JSON.stringify({ error: 'Memory not found' }))
      } else {
        console.error('Error: Memory not found')
      }
      process.exit(1)
    }

    if (options.json) {
      console.log(JSON.stringify(memory, null, 2))
      return
    }

    const confidence = calculateConfidence(memory)
    const createdAt = new Date(memory.metadata.created_at)
    const lastValidated = memory.metadata.last_validated_at
      ? new Date(memory.metadata.last_validated_at)
      : null

    console.log('\n📋 Memory Details:')
    console.log(`   ID:         ${memory.id}`)
    console.log(`   Collection: ${memory.metadata.collection}`)
    console.log(`   Source:     ${memory.metadata.source}`)
    console.log(`   Confidence: ${(confidence * 100).toFixed(0)}%`)
    console.log(`   Created:    ${createdAt.toLocaleString()}`)
    if (lastValidated) {
      console.log(`   Validated:  ${lastValidated.toLocaleString()}`)
    }

    if (memory.metadata.app_slug) {
      console.log(`   App:        ${memory.metadata.app_slug}`)
    }

    if (memory.metadata.tags && memory.metadata.tags.length > 0) {
      console.log(`   Tags:       ${memory.metadata.tags.join(', ')}`)
    }

    console.log('\n📝 Content:')
    console.log(`   ${memory.content}\n`)

    if (memory.metadata.votes) {
      const { upvotes, downvotes, citations, success_rate } =
        memory.metadata.votes
      if (upvotes > 0 || downvotes > 0 || citations > 0) {
        console.log('📊 Votes:')
        console.log(`   Upvotes:      ${upvotes}`)
        console.log(`   Downvotes:    ${downvotes}`)
        console.log(`   Citations:    ${citations}`)
        console.log(`   Success Rate: ${(success_rate * 100).toFixed(0)}%\n`)
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
