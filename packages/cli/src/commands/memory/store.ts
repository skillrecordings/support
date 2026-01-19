import { MemoryService } from '@skillrecordings/memory/memory'

/**
 * Store a new memory with optional tags and collection
 */
export async function store(
  content: string,
  options: {
    tags?: string
    collection?: string
    app?: string
    json?: boolean
  }
): Promise<void> {
  try {
    const memory = await MemoryService.store(content, {
      collection: options.collection || 'learnings',
      source: 'human',
      app_slug: options.app,
      tags: options.tags?.split(',').map((t) => t.trim()) ?? [],
    })

    if (options.json) {
      console.log(JSON.stringify(memory, null, 2))
    } else {
      console.log(`✓ Stored memory: ${memory.id}`)
      if (memory.metadata.tags && memory.metadata.tags.length > 0) {
        console.log(`  Tags: ${memory.metadata.tags.join(', ')}`)
      }
      if (memory.metadata.app_slug) {
        console.log(`  App: ${memory.metadata.app_slug}`)
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
