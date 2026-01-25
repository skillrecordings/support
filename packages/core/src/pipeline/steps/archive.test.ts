/**
 * Archive step tests
 */

import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  archiveConversation,
  createArchiveStep,
  shouldArchive,
} from './archive'

// Mock Front SDK
vi.mock('@skillrecordings/front-sdk', () => ({
  createFrontClient: vi.fn(() => ({
    conversations: {
      update: vi.fn(),
    },
  })),
}))

import { createFrontClient } from '@skillrecordings/front-sdk'

describe('shouldArchive', () => {
  it('returns true for silence action', () => {
    expect(shouldArchive('silence')).toBe(true)
  })

  it('returns false for respond action', () => {
    expect(shouldArchive('respond')).toBe(false)
  })

  it('returns false for escalation actions', () => {
    expect(shouldArchive('escalate_human')).toBe(false)
    expect(shouldArchive('escalate_instructor')).toBe(false)
    expect(shouldArchive('escalate_urgent')).toBe(false)
  })

  it('returns false for other actions', () => {
    expect(shouldArchive('support_teammate')).toBe(false)
    expect(shouldArchive('catalog_voc')).toBe(false)
  })
})

describe('archiveConversation', () => {
  let mockFront: {
    conversations: {
      update: Mock
    }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockFront = {
      conversations: {
        update: vi.fn(),
      },
    }
    ;(createFrontClient as Mock).mockReturnValue(mockFront)
  })

  it('archives conversation when action is silence', async () => {
    mockFront.conversations.update.mockResolvedValue(undefined)

    const result = await archiveConversation(
      {
        conversationId: 'cnv_123',
        action: 'silence',
        reason: 'Spam detected',
        appConfig: {
          appId: 'app_1',
          autoSendEnabled: false,
          instructorConfigured: false,
        },
      },
      { frontApiToken: 'test-token' }
    )

    expect(result.archived).toBe(true)
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
    expect(mockFront.conversations.update).toHaveBeenCalledWith('cnv_123', {
      status: 'archived',
    })
  })

  it('skips archive when action is respond', async () => {
    const result = await archiveConversation(
      {
        conversationId: 'cnv_123',
        action: 'respond',
        reason: 'Support request',
        appConfig: {
          appId: 'app_1',
          autoSendEnabled: false,
          instructorConfigured: false,
        },
      },
      { frontApiToken: 'test-token' }
    )

    expect(result.archived).toBe(false)
    expect(result.error).toBeUndefined()
    expect(mockFront.conversations.update).not.toHaveBeenCalled()
  })

  it('skips archive when action is escalate_human', async () => {
    const result = await archiveConversation(
      {
        conversationId: 'cnv_123',
        action: 'escalate_human',
        reason: 'Needs human review',
        appConfig: {
          appId: 'app_1',
          autoSendEnabled: false,
          instructorConfigured: false,
        },
      },
      { frontApiToken: 'test-token' }
    )

    expect(result.archived).toBe(false)
    expect(mockFront.conversations.update).not.toHaveBeenCalled()
  })

  it('handles Front API errors gracefully', async () => {
    mockFront.conversations.update.mockRejectedValue(new Error('API Error'))

    const result = await archiveConversation(
      {
        conversationId: 'cnv_123',
        action: 'silence',
        reason: 'Spam',
        appConfig: {
          appId: 'app_1',
          autoSendEnabled: false,
          instructorConfigured: false,
        },
      },
      { frontApiToken: 'test-token' }
    )

    expect(result.archived).toBe(false)
    expect(result.error).toBe('API Error')
  })
})

describe('createArchiveStep', () => {
  it('creates a configured archive function', async () => {
    const mockFront = {
      conversations: {
        update: vi.fn().mockResolvedValue(undefined),
      },
    }
    ;(createFrontClient as Mock).mockReturnValue(mockFront)

    const archiveStep = createArchiveStep({ frontApiToken: 'test-token' })
    const result = await archiveStep({
      conversationId: 'cnv_123',
      action: 'silence',
      reason: 'Spam',
      appConfig: {
        appId: 'app_1',
        autoSendEnabled: false,
        instructorConfigured: false,
      },
    })

    expect(result.archived).toBe(true)
  })
})
