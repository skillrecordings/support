import { describe, expect, it, vi } from 'vitest'
import {
  type RefinementIntent,
  applyRefinement,
  createDraftThreadState,
  parseRefinementIntent,
} from '../draft'

describe('draft refinement intent parsing', () => {
  it('parses simplify refinements', () => {
    expect(parseRefinementIntent('please simplify this')).toEqual({
      type: 'simplify',
    })
  })

  it('extracts add content from bracketed text', () => {
    expect(parseRefinementIntent('add [https://example.com]')).toEqual({
      type: 'add_content',
      content: 'https://example.com',
    })
  })

  it('detects approval language', () => {
    expect(parseRefinementIntent('looks good')).toEqual({ type: 'approve' })
  })
})

describe('draft versioning', () => {
  it('tracks revision history', async () => {
    const now = vi.fn(() => new Date('2025-01-01T00:00:00Z'))
    const logger = vi.fn().mockResolvedValue(undefined)
    const initializeAxiom = vi.fn()

    const state = createDraftThreadState('thread-1', 'Original draft', { now })

    const firstIntent: RefinementIntent = { type: 'simplify' }
    const generateTextFirst = vi.fn().mockResolvedValue({
      text: 'Simplified draft',
    })

    const first = await applyRefinement(
      state,
      firstIntent,
      { generateText: generateTextFirst, now, logger, initializeAxiom },
      { threadTs: 'thread-1', userId: 'U1' }
    )

    expect(first.state.versions).toHaveLength(2)
    expect(first.state.versions.map((version) => version.id)).toEqual([
      'v0',
      'v1',
    ])

    const secondIntent: RefinementIntent = { type: 'shorten' }
    const generateTextSecond = vi.fn().mockResolvedValue({
      text: 'Short draft',
    })

    const second = await applyRefinement(
      first.state,
      secondIntent,
      { generateText: generateTextSecond, now, logger, initializeAxiom },
      { threadTs: 'thread-1', userId: 'U1' }
    )

    expect(second.state.versions).toHaveLength(3)
    expect(second.state.versions.map((version) => version.id)).toEqual([
      'v0',
      'v1',
      'v2',
    ])
  })
})
