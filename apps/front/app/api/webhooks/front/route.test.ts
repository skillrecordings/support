/**
 * Tests for Front webhook handler
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the inngest client
vi.mock('@skillrecordings/core/inngest', () => ({
  SUPPORT_INBOUND_RECEIVED: 'support/inbound.received',
  SUPPORT_COMMENT_RECEIVED: 'support/comment.received',
  SUPPORT_CONVERSATION_SNOOZED: 'support/conversation.snoozed',
  SUPPORT_SNOOZE_EXPIRED: 'support/snooze.expired',
  inngest: {
    send: vi.fn().mockResolvedValue(undefined),
  },
}))

// Mock the app registry
vi.mock('@skillrecordings/core/services/app-registry', () => ({
  getAppByInboxId: vi.fn(),
}))

// Mock the webhook verification
vi.mock('@skillrecordings/core/webhooks', () => ({
  verifyFrontWebhook: vi.fn(),
}))

import { inngest } from '@skillrecordings/core/inngest'
import { getAppByInboxId } from '@skillrecordings/core/services/app-registry'
import { verifyFrontWebhook } from '@skillrecordings/core/webhooks'
import { POST } from './route'

describe('Front Webhook Handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.FRONT_WEBHOOK_SECRET = 'test-secret'

    // Default mock for verification - always valid
    vi.mocked(verifyFrontWebhook).mockReturnValue({ valid: true })

    // Default mock for app registry - returns a test app
    vi.mocked(getAppByInboxId).mockResolvedValue({
      slug: 'test-app',
      name: 'Test App',
      front_inbox_id: 'inb_test123',
    } as any)
  })

  afterEach(() => {
    delete process.env.FRONT_WEBHOOK_SECRET
  })

  function createMockRequest(payload: object): Request {
    return new Request('http://localhost/api/webhooks/front', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-front-signature': 'test-signature',
      },
      body: JSON.stringify(payload),
    })
  }

  describe('comment events', () => {
    it('handles conversation.comment.created event and dispatches to Inngest', async () => {
      const commentPayload = {
        type: 'comment',
        authorization: { id: 'cmp_test' },
        payload: {
          id: 'evt_comment123',
          type: 'comment',
          emitted_at: 1700000000,
          conversation: {
            id: 'cnv_abc123',
            subject: 'Test conversation',
            _links: {
              self: 'https://api.frontapp.com/conversations/cnv_abc123',
            },
          },
          target: {
            _meta: { type: 'comment' },
            data: {
              id: 'com_xyz789',
              body: '<p>This is a test comment</p>',
              author: {
                id: 'tea_author1',
                email: 'agent@example.com',
                first_name: 'Test',
                last_name: 'Agent',
              },
              posted_at: 1700000000,
              _links: {
                self: 'https://api.frontapp.com/comments/com_xyz789',
              },
            },
          },
          source: {
            _meta: { type: 'inboxes' },
            data: [{ id: 'inb_test123' }],
          },
        },
      }

      const response = await POST(createMockRequest(commentPayload) as any)
      const json = await response.json()

      expect(response.status).toBe(200)
      expect(json).toEqual({ received: true })

      // Verify Inngest was called with correct event
      expect(inngest.send).toHaveBeenCalledTimes(1)
      expect(inngest.send).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'support/comment.received',
          data: expect.objectContaining({
            conversationId: 'cnv_abc123',
            commentId: 'com_xyz789',
            body: '<p>This is a test comment</p>',
            author: {
              id: 'tea_author1',
              email: 'agent@example.com',
              name: 'Test Agent',
            },
            appId: 'test-app',
            inboxId: 'inb_test123',
            postedAt: 1700000000,
          }),
        })
      )
    })

    it('skips comment events with no matching app', async () => {
      // Return null for app lookup - no registered app
      vi.mocked(getAppByInboxId).mockResolvedValue(null)

      const commentPayload = {
        type: 'comment',
        payload: {
          conversation: { id: 'cnv_abc123' },
          target: {
            _meta: { type: 'comment' },
            data: {
              id: 'com_xyz789',
              body: 'Test comment',
              author: { id: 'tea_1' },
            },
          },
          source: {
            data: [{ id: 'inb_unknown' }],
          },
        },
      }

      const response = await POST(createMockRequest(commentPayload) as any)
      const json = await response.json()

      expect(response.status).toBe(200)
      expect(json).toEqual({ received: true })

      // Inngest should NOT be called for unknown inboxes
      expect(inngest.send).not.toHaveBeenCalled()
    })

    it('handles comment events without author info gracefully', async () => {
      const commentPayload = {
        type: 'comment',
        payload: {
          conversation: { id: 'cnv_abc123' },
          target: {
            _meta: { type: 'comment' },
            data: {
              id: 'com_xyz789',
              body: 'Anonymous comment',
              // No author field
            },
          },
          source: {
            data: [{ id: 'inb_test123' }],
          },
        },
      }

      const response = await POST(createMockRequest(commentPayload) as any)
      expect(response.status).toBe(200)

      expect(inngest.send).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'support/comment.received',
          data: expect.objectContaining({
            author: {
              id: 'unknown',
              email: undefined,
              name: undefined,
            },
          }),
        })
      )
    })

    it('handles comment events without comment ID', async () => {
      const commentPayload = {
        type: 'comment',
        payload: {
          conversation: { id: 'cnv_abc123' },
          target: {
            _meta: { type: 'comment' },
            data: {
              // Missing id
              body: 'Test comment',
            },
          },
          source: {
            data: [{ id: 'inb_test123' }],
          },
        },
      }

      const response = await POST(createMockRequest(commentPayload) as any)
      const json = await response.json()

      expect(response.status).toBe(200)
      expect(json).toEqual({ received: true })

      // Should not send to Inngest when comment ID is missing
      expect(inngest.send).not.toHaveBeenCalled()
    })
  })

  describe('inbound_received events', () => {
    it('continues to handle inbound messages correctly', async () => {
      const inboundPayload = {
        type: 'inbound_received',
        payload: {
          conversation: {
            id: 'cnv_abc123',
            subject: 'Test subject',
            _links: {
              self: 'https://api.frontapp.com/conversations/cnv_abc123',
            },
          },
          target: {
            _meta: { type: 'message' },
            data: {
              id: 'msg_xyz789',
              _links: {
                self: 'https://api.frontapp.com/messages/msg_xyz789',
              },
            },
          },
          source: {
            _meta: { type: 'inboxes' },
            data: [{ id: 'inb_test123' }],
          },
        },
      }

      const response = await POST(createMockRequest(inboundPayload) as any)
      const json = await response.json()

      expect(response.status).toBe(200)
      expect(json).toEqual({ received: true })

      // Verify Inngest was called with inbound event
      expect(inngest.send).toHaveBeenCalledTimes(1)
      expect(inngest.send).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'support/inbound.received',
          data: expect.objectContaining({
            conversationId: 'cnv_abc123',
            messageId: 'msg_xyz789',
            appId: 'test-app',
          }),
        })
      )
    })
  })

  describe('sync events', () => {
    it('acknowledges sync events without processing', async () => {
      const syncPayload = { type: 'sync' }

      const response = await POST(createMockRequest(syncPayload) as any)
      const json = await response.json()

      expect(response.status).toBe(200)
      expect(json).toEqual({ received: true })
      expect(inngest.send).not.toHaveBeenCalled()
    })
  })

  describe('signature verification', () => {
    it('rejects requests with invalid signatures', async () => {
      vi.mocked(verifyFrontWebhook).mockReturnValue({
        valid: false,
        error: 'Invalid signature',
      })

      const payload = { type: 'comment', payload: {} }
      const response = await POST(createMockRequest(payload) as any)
      const json = await response.json()

      expect(response.status).toBe(401)
      expect(json).toEqual({ error: 'Invalid signature' })
    })

    it('responds to challenge requests', async () => {
      vi.mocked(verifyFrontWebhook).mockReturnValue({
        valid: true,
        challenge: 'test-challenge-value',
      })

      const payload = {}
      const response = await POST(createMockRequest(payload) as any)
      const json = await response.json()

      expect(response.status).toBe(200)
      expect(json).toEqual({ challenge: 'test-challenge-value' })
    })
  })

  describe('conversation_snoozed events', () => {
    it('handles conversation_snoozed event and dispatches to Inngest', async () => {
      const snoozePayload = {
        type: 'conversation_snoozed',
        authorization: { id: 'cmp_test' },
        payload: {
          id: 'evt_snooze123',
          type: 'conversation_snoozed',
          emitted_at: 1700000000,
          snooze_until: 1700086400, // 24 hours later
          conversation: {
            id: 'cnv_abc123',
            subject: 'Snoozed conversation',
            _links: {
              self: 'https://api.frontapp.com/conversations/cnv_abc123',
            },
          },
          source: {
            _meta: { type: 'inboxes' },
            data: [{ id: 'inb_test123' }],
          },
        },
      }

      const response = await POST(createMockRequest(snoozePayload) as any)
      const json = await response.json()

      expect(response.status).toBe(200)
      expect(json).toEqual({ received: true })

      // Verify Inngest was called with snooze event
      expect(inngest.send).toHaveBeenCalledTimes(1)
      expect(inngest.send).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'support/conversation.snoozed',
          data: expect.objectContaining({
            conversationId: 'cnv_abc123',
            appId: 'test-app',
            inboxId: 'inb_test123',
            snoozedAt: 1700000000,
            snoozedUntil: 1700086400,
          }),
        })
      )
    })

    it('skips conversation_snoozed events with no matching app', async () => {
      vi.mocked(getAppByInboxId).mockResolvedValue(null)

      const snoozePayload = {
        type: 'conversation_snoozed',
        payload: {
          emitted_at: 1700000000,
          conversation: { id: 'cnv_abc123' },
          source: {
            data: [{ id: 'inb_unknown' }],
          },
        },
      }

      const response = await POST(createMockRequest(snoozePayload) as any)
      const json = await response.json()

      expect(response.status).toBe(200)
      expect(json).toEqual({ received: true })

      // Inngest should NOT be called for unknown inboxes
      expect(inngest.send).not.toHaveBeenCalled()
    })

    it('handles conversation_snoozed without snooze_until', async () => {
      const snoozePayload = {
        type: 'conversation_snoozed',
        payload: {
          emitted_at: 1700000000,
          conversation: { id: 'cnv_abc123' },
          source: {
            data: [{ id: 'inb_test123' }],
          },
        },
      }

      const response = await POST(createMockRequest(snoozePayload) as any)
      expect(response.status).toBe(200)

      expect(inngest.send).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'support/conversation.snoozed',
          data: expect.objectContaining({
            conversationId: 'cnv_abc123',
            snoozedAt: 1700000000,
            snoozedUntil: undefined,
          }),
        })
      )
    })
  })

  describe('snooze_expired events', () => {
    it('handles snooze_expired event and dispatches to Inngest', async () => {
      const expiredPayload = {
        type: 'snooze_expired',
        authorization: { id: 'cmp_test' },
        payload: {
          id: 'evt_expired123',
          type: 'snooze_expired',
          emitted_at: 1700086400,
          conversation: {
            id: 'cnv_abc123',
            subject: 'Snooze expired conversation',
            _links: {
              self: 'https://api.frontapp.com/conversations/cnv_abc123',
            },
          },
          source: {
            _meta: { type: 'inboxes' },
            data: [{ id: 'inb_test123' }],
          },
        },
      }

      const response = await POST(createMockRequest(expiredPayload) as any)
      const json = await response.json()

      expect(response.status).toBe(200)
      expect(json).toEqual({ received: true })

      // Verify Inngest was called with snooze expired event
      expect(inngest.send).toHaveBeenCalledTimes(1)
      expect(inngest.send).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'support/snooze.expired',
          data: expect.objectContaining({
            conversationId: 'cnv_abc123',
            appId: 'test-app',
            inboxId: 'inb_test123',
            expiredAt: 1700086400,
          }),
        })
      )
    })

    it('skips snooze_expired events with no matching app', async () => {
      vi.mocked(getAppByInboxId).mockResolvedValue(null)

      const expiredPayload = {
        type: 'snooze_expired',
        payload: {
          emitted_at: 1700086400,
          conversation: { id: 'cnv_abc123' },
          source: {
            data: [{ id: 'inb_unknown' }],
          },
        },
      }

      const response = await POST(createMockRequest(expiredPayload) as any)
      const json = await response.json()

      expect(response.status).toBe(200)
      expect(json).toEqual({ received: true })

      // Inngest should NOT be called for unknown inboxes
      expect(inngest.send).not.toHaveBeenCalled()
    })

    it('handles snooze_expired without emitted_at (uses current time)', async () => {
      const expiredPayload = {
        type: 'snooze_expired',
        payload: {
          conversation: { id: 'cnv_abc123' },
          source: {
            data: [{ id: 'inb_test123' }],
          },
        },
      }

      const beforeTime = Math.floor(Date.now() / 1000)
      const response = await POST(createMockRequest(expiredPayload) as any)
      const afterTime = Math.floor(Date.now() / 1000)

      expect(response.status).toBe(200)

      expect(inngest.send).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'support/snooze.expired',
          data: expect.objectContaining({
            conversationId: 'cnv_abc123',
            expiredAt: expect.any(Number),
          }),
        })
      )

      // Verify the expiredAt is a reasonable timestamp
      const sentData = (inngest.send as any).mock.calls[0][0].data
      expect(sentData.expiredAt).toBeGreaterThanOrEqual(beforeTime)
      expect(sentData.expiredAt).toBeLessThanOrEqual(afterTime)
    })
  })
})
