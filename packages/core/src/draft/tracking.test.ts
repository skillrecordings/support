import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  embedDraftId,
  extractDraftId,
  getDraftTracking,
  removeDraftTracking,
  storeDraftTracking,
} from './tracking'
import type { DraftTrackingData } from './types'

// Mock Redis
const mockRedis = {
  set: vi.fn(),
  get: vi.fn(),
  del: vi.fn(),
}

vi.mock('../redis/client', () => ({
  getRedis: () => mockRedis,
}))

describe('Draft Tracking', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('embedDraftId', () => {
    it('should append action ID marker to content', () => {
      const content = '<p>Hello, thank you for reaching out!</p>'
      const actionId = 'action_123abc'

      const result = embedDraftId(content, actionId)

      expect(result).toBe(
        '<p>Hello, thank you for reaching out!</p><!-- agent-draft-id:action_123abc -->'
      )
    })

    it('should handle empty content', () => {
      const result = embedDraftId('', 'action_xyz')
      expect(result).toBe('<!-- agent-draft-id:action_xyz -->')
    })

    it('should handle content with existing HTML comments', () => {
      const content = '<p>Hello</p><!-- existing comment -->'
      const actionId = 'action_456'

      const result = embedDraftId(content, actionId)

      expect(result).toBe(
        '<p>Hello</p><!-- existing comment --><!-- agent-draft-id:action_456 -->'
      )
    })

    it('should handle multiline content', () => {
      const content = `<div>
        <p>Line 1</p>
        <p>Line 2</p>
      </div>`
      const actionId = 'action_multi'

      const result = embedDraftId(content, actionId)

      expect(result).toContain('<!-- agent-draft-id:action_multi -->')
      expect(result.endsWith('<!-- agent-draft-id:action_multi -->')).toBe(true)
    })
  })

  describe('extractDraftId', () => {
    it('should extract action ID from content with marker', () => {
      const content =
        '<p>Hello!</p><!-- agent-draft-id:action_123abc --><p>More text</p>'

      const result = extractDraftId(content)

      expect(result).toBe('action_123abc')
    })

    it('should return null for content without marker', () => {
      const content = '<p>Hello, no marker here!</p>'

      const result = extractDraftId(content)

      expect(result).toBeNull()
    })

    it('should return null for empty content', () => {
      expect(extractDraftId('')).toBeNull()
    })

    it('should return null for null/undefined content', () => {
      expect(extractDraftId(null as unknown as string)).toBeNull()
      expect(extractDraftId(undefined as unknown as string)).toBeNull()
    })

    it('should handle marker at end of content', () => {
      const content = '<p>Hello!</p><!-- agent-draft-id:action_end -->'

      const result = extractDraftId(content)

      expect(result).toBe('action_end')
    })

    it('should handle incomplete marker (missing suffix)', () => {
      const content = '<p>Hello!</p><!-- agent-draft-id:action_incomplete'

      const result = extractDraftId(content)

      expect(result).toBeNull()
    })

    it('should handle incomplete marker (missing prefix)', () => {
      const content = '<p>Hello!</p>action_123abc -->'

      const result = extractDraftId(content)

      expect(result).toBeNull()
    })

    it('should handle empty action ID in marker', () => {
      const content = '<p>Hello!</p><!-- agent-draft-id: -->'

      const result = extractDraftId(content)

      expect(result).toBeNull()
    })

    it('should extract first marker if multiple present', () => {
      const content =
        '<p>Hello!</p><!-- agent-draft-id:first_action --><!-- agent-draft-id:second_action -->'

      const result = extractDraftId(content)

      expect(result).toBe('first_action')
    })

    it('should handle action ID with special characters', () => {
      const content = '<p>Hello!</p><!-- agent-draft-id:action_123-abc_456 -->'

      const result = extractDraftId(content)

      expect(result).toBe('action_123-abc_456')
    })
  })

  describe('storeDraftTracking', () => {
    it('should store data in Redis with correct key and TTL', async () => {
      const actionId = 'action_store_test'
      const data: DraftTrackingData = {
        actionId,
        conversationId: 'cnv_123',
        draftId: 'drf_456',
        appId: 'app_test',
        category: 'refund_request',
        confidence: 0.95,
        autoApproved: true,
        customerEmail: '[EMAIL]',
        createdAt: new Date().toISOString(),
      }

      await storeDraftTracking(actionId, data)

      expect(mockRedis.set).toHaveBeenCalledWith(
        'draft:tracking:action_store_test',
        JSON.stringify(data),
        { ex: 48 * 60 * 60 }
      )
    })
  })

  describe('getDraftTracking', () => {
    it('should retrieve and parse data from Redis', async () => {
      const actionId = 'action_get_test'
      const storedData: DraftTrackingData = {
        actionId,
        conversationId: 'cnv_789',
        draftId: 'drf_012',
        appId: 'app_get',
        category: 'password_reset',
        confidence: 0.88,
        autoApproved: false,
        createdAt: '2024-01-15T10:00:00Z',
      }

      mockRedis.get.mockResolvedValue(JSON.stringify(storedData))

      const result = await getDraftTracking(actionId)

      expect(mockRedis.get).toHaveBeenCalledWith(
        'draft:tracking:action_get_test'
      )
      expect(result).toEqual(storedData)
    })

    it('should return null when key not found', async () => {
      mockRedis.get.mockResolvedValue(null)

      const result = await getDraftTracking('nonexistent_action')

      expect(result).toBeNull()
    })

    it('should handle pre-parsed object from Redis', async () => {
      const storedData: DraftTrackingData = {
        actionId: 'action_parsed',
        conversationId: 'cnv_parsed',
        draftId: 'drf_parsed',
        appId: 'app_parsed',
        category: 'general_inquiry',
        confidence: 0.75,
        autoApproved: true,
        createdAt: '2024-01-15T12:00:00Z',
      }

      // Some Redis clients return pre-parsed objects
      mockRedis.get.mockResolvedValue(storedData)

      const result = await getDraftTracking('action_parsed')

      expect(result).toEqual(storedData)
    })

    it('should return null for invalid JSON', async () => {
      mockRedis.get.mockResolvedValue('invalid json {{{')

      const result = await getDraftTracking('action_invalid')

      expect(result).toBeNull()
    })
  })

  describe('removeDraftTracking', () => {
    it('should delete key from Redis', async () => {
      const actionId = 'action_to_remove'

      await removeDraftTracking(actionId)

      expect(mockRedis.del).toHaveBeenCalledWith(
        'draft:tracking:action_to_remove'
      )
    })
  })

  describe('round-trip: embed and extract', () => {
    it('should successfully embed and extract action ID', () => {
      const originalContent = '<p>Thank you for your purchase!</p>'
      const actionId = 'action_roundtrip_123'

      const contentWithId = embedDraftId(originalContent, actionId)
      const extractedId = extractDraftId(contentWithId)

      expect(extractedId).toBe(actionId)
    })

    it('should work with complex HTML content', () => {
      const originalContent = `
        <div style="font-family: Arial;">
          <h1>Hello!</h1>
          <p>Thank you for contacting us.</p>
          <ul>
            <li>Item 1</li>
            <li>Item 2</li>
          </ul>
          <!-- Some existing comment -->
          <p>Best regards,<br/>Support Team</p>
        </div>
      `
      const actionId = 'action_complex_html'

      const contentWithId = embedDraftId(originalContent, actionId)
      const extractedId = extractDraftId(contentWithId)

      expect(extractedId).toBe(actionId)
    })
  })
})
