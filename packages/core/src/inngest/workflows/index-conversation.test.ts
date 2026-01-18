import { beforeEach, describe, expect, it, vi } from 'vitest'

// Hoist mocks before imports
const mockRedactPII = vi.hoisted(() => vi.fn())
const mockGetVectorIndex = vi.hoisted(() => vi.fn())
const mockUpsertVector = vi.hoisted(() => vi.fn())
const mockUpdateTrustScore = vi.hoisted(() => vi.fn())

vi.mock('../../vector/redact', () => ({
  redactPII: mockRedactPII(),
}))

vi.mock('../../vector/client', () => ({
  getVectorIndex: mockGetVectorIndex(),
  upsertVector: mockUpsertVector(),
}))

vi.mock('../../trust/score', () => ({
  updateTrustScore: mockUpdateTrustScore(),
}))

import type { SupportConversationResolvedEvent } from '../events'
import { indexConversation } from './index-conversation'

describe('indexConversation workflow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should be defined', () => {
    expect(indexConversation).toBeDefined()
  })

  it('should have correct Inngest config', () => {
    expect(indexConversation.id()).toBe('index-conversation')
  })

  // Integration test would require mocking Inngest step functions
  // For now, we verify the function structure and exports
})
