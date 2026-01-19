import {
  MemoryService,
  type SearchOptions,
  type StoreMetadata,
} from '@skillrecordings/memory/memory'
import type { SearchResult } from '@skillrecordings/memory/schemas'
import { type VoteType, VotingService } from '@skillrecordings/memory/voting'
import { NextRequest, NextResponse } from 'next/server'

/**
 * GET /api/plugin/memories?query=<search>
 * Search memories by semantic similarity
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const query = searchParams.get('query')

    if (!query) {
      return NextResponse.json(
        { error: 'Query parameter is required' },
        { status: 400 }
      )
    }

    // Search memories with default collection 'learnings'
    const results = await MemoryService.find(query, {
      collection: 'learnings',
      limit: 10,
      threshold: 0.5,
    })

    return NextResponse.json({
      success: true,
      results: results.map((result: SearchResult) => ({
        id: result.memory.id,
        content: result.memory.content,
        score: result.score,
        raw_score: result.raw_score,
        age_days: result.age_days,
        confidence: result.memory.metadata.confidence,
        tags: result.memory.metadata.tags,
        created_at: result.memory.metadata.created_at,
        votes: result.memory.metadata.votes,
      })),
    })
  } catch (error) {
    console.error('Memory search error:', error)
    return NextResponse.json(
      { error: 'Failed to search memories' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/plugin/memories
 * Store a new memory or perform voting actions
 *
 * Actions:
 * - store: { action: 'store', content: string, tags?: string[] }
 * - upvote: { action: 'upvote', memory_id: string, collection?: string }
 * - downvote: { action: 'downvote', memory_id: string, collection?: string }
 * - validate: { action: 'validate', memory_id: string, collection?: string }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { action } = body

    if (!action) {
      return NextResponse.json({ error: 'Action is required' }, { status: 400 })
    }

    switch (action) {
      case 'store': {
        const { content, tags } = body

        if (!content || typeof content !== 'string') {
          return NextResponse.json(
            { error: 'Content is required and must be a string' },
            { status: 400 }
          )
        }

        const memory = await MemoryService.store(content, {
          collection: 'learnings',
          source: 'human',
          tags: tags || [],
        })

        return NextResponse.json({
          success: true,
          memory: {
            id: memory.id,
            content: memory.content,
            tags: memory.metadata.tags,
            created_at: memory.metadata.created_at,
          },
        })
      }

      case 'upvote':
      case 'downvote': {
        const { memory_id, collection = 'learnings' } = body

        if (!memory_id || typeof memory_id !== 'string') {
          return NextResponse.json(
            { error: 'memory_id is required and must be a string' },
            { status: 400 }
          )
        }

        await VotingService.vote(memory_id, collection, action)

        return NextResponse.json({
          success: true,
          message: `Memory ${action}d successfully`,
        })
      }

      case 'validate': {
        const { memory_id, collection = 'learnings' } = body

        if (!memory_id || typeof memory_id !== 'string') {
          return NextResponse.json(
            { error: 'memory_id is required and must be a string' },
            { status: 400 }
          )
        }

        await MemoryService.validate(memory_id, collection)

        return NextResponse.json({
          success: true,
          message: 'Memory validated successfully',
        })
      }

      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 }
        )
    }
  } catch (error) {
    console.error('Memory action error:', error)
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Failed to process action',
      },
      { status: 500 }
    )
  }
}
