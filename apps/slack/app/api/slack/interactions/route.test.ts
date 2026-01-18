import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import { POST } from './route'
import { verifySlackSignature } from '../../../../lib/verify-signature'
import { inngest } from '@skillrecordings/core/inngest'

// Mock dependencies
vi.mock('../../../../lib/verify-signature', () => ({
  verifySlackSignature: vi.fn(),
}))

vi.mock('@skillrecordings/core/inngest', () => ({
  inngest: {
    send: vi.fn(),
  },
}))

// Type the mocked functions
const mockVerifySlackSignature = verifySlackSignature as unknown as Mock
const mockInngestSend = inngest.send as unknown as Mock

describe('POST /api/slack/interactions', () => {
  const mockApprovePayload = {
    type: 'block_actions',
    user: {
      id: 'U123456',
      username: 'test.user',
    },
    actions: [
      {
        action_id: 'approve_action',
        value: JSON.stringify({
          actionId: 'action-123',
          conversationId: 'conv-456',
          appId: 'total-typescript',
        }),
      },
    ],
    response_url: 'https://hooks.slack.com/actions/T123/B456/xyz',
    trigger_id: 'trigger-789',
  }

  const mockRejectPayload = {
    type: 'block_actions',
    user: {
      id: 'U123456',
      username: 'test.user',
    },
    actions: [
      {
        action_id: 'reject_action',
        value: JSON.stringify({
          actionId: 'action-123',
          conversationId: 'conv-456',
          appId: 'total-typescript',
        }),
      },
    ],
    response_url: 'https://hooks.slack.com/actions/T123/B456/xyz',
    trigger_id: 'trigger-789',
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('signature verification', () => {
    it('should return 401 when signature is invalid', async () => {
      const body = new URLSearchParams({
        payload: JSON.stringify(mockApprovePayload),
      }).toString()

      const request = new Request('http://localhost:3000/api/slack/interactions', {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'x-slack-signature': 'v0=invalid',
          'x-slack-request-timestamp': Math.floor(Date.now() / 1000).toString(),
        },
        body,
      })

      mockVerifySlackSignature.mockReturnValue(false)

      const response = await POST(request)
      expect(response.status).toBe(401)

      const text = await response.text()
      expect(text).toBe('Invalid signature')
    })

    it('should verify signature with correct parameters', async () => {
      const timestamp = Math.floor(Date.now() / 1000).toString()
      const body = new URLSearchParams({
        payload: JSON.stringify(mockApprovePayload),
      }).toString()

      const request = new Request('http://localhost:3000/api/slack/interactions', {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'x-slack-signature': 'v0=abc123',
          'x-slack-request-timestamp': timestamp,
        },
        body,
      })

      mockVerifySlackSignature.mockReturnValue(true)
      mockInngestSend.mockResolvedValue(undefined as any)

      await POST(request)

      expect(verifySlackSignature).toHaveBeenCalledWith({
        signature: 'v0=abc123',
        timestamp,
        body,
      })
    })
  })

  describe('approve action', () => {
    it('should emit approval events when approve button clicked', async () => {
      const timestamp = Math.floor(Date.now() / 1000).toString()
      const body = new URLSearchParams({
        payload: JSON.stringify(mockApprovePayload),
      }).toString()

      const request = new Request('http://localhost:3000/api/slack/interactions', {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'x-slack-signature': 'v0=valid',
          'x-slack-request-timestamp': timestamp,
        },
        body,
      })

      mockVerifySlackSignature.mockReturnValue(true)
      mockInngestSend.mockResolvedValue(undefined as any)

      const response = await POST(request)

      expect(response.status).toBe(200)
      expect(await response.text()).toBe('OK')

      // Should emit both events in a single call
      expect(inngest.send).toHaveBeenCalledWith([
        {
          name: 'support/approval.decided',
          data: {
            approvalId: 'action-123',
            decision: 'approved',
            decidedBy: 'test.user',
            decidedAt: expect.any(String),
          },
        },
        {
          name: 'support/action.approved',
          data: {
            actionId: 'action-123',
            approvedBy: 'test.user',
            approvedAt: expect.any(String),
          },
        },
      ])
    })
  })

  describe('reject action', () => {
    it('should emit rejection events when reject button clicked', async () => {
      const timestamp = Math.floor(Date.now() / 1000).toString()
      const body = new URLSearchParams({
        payload: JSON.stringify(mockRejectPayload),
      }).toString()

      const request = new Request('http://localhost:3000/api/slack/interactions', {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'x-slack-signature': 'v0=valid',
          'x-slack-request-timestamp': timestamp,
        },
        body,
      })

      mockVerifySlackSignature.mockReturnValue(true)
      mockInngestSend.mockResolvedValue(undefined as any)

      const response = await POST(request)

      expect(response.status).toBe(200)
      expect(await response.text()).toBe('OK')

      // Should emit both events in a single call
      expect(inngest.send).toHaveBeenCalledWith([
        {
          name: 'support/approval.decided',
          data: {
            approvalId: 'action-123',
            decision: 'rejected',
            decidedBy: 'test.user',
            decidedAt: expect.any(String),
          },
        },
        {
          name: 'support/action.rejected',
          data: {
            actionId: 'action-123',
            rejectedBy: 'test.user',
            rejectedAt: expect.any(String),
          },
        },
      ])
    })
  })

  describe('unknown actions', () => {
    it('should ignore unknown action_id gracefully', async () => {
      const unknownPayload = {
        ...mockApprovePayload,
        actions: [
          {
            action_id: 'unknown_action',
            value: JSON.stringify({
              actionId: 'action-123',
            }),
          },
        ],
      }

      const timestamp = Math.floor(Date.now() / 1000).toString()
      const body = new URLSearchParams({
        payload: JSON.stringify(unknownPayload),
      }).toString()

      const request = new Request('http://localhost:3000/api/slack/interactions', {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'x-slack-signature': 'v0=valid',
          'x-slack-request-timestamp': timestamp,
        },
        body,
      })

      mockVerifySlackSignature.mockReturnValue(true)
      mockInngestSend.mockResolvedValue(undefined as any)

      const response = await POST(request)

      expect(response.status).toBe(200)
      expect(inngest.send).not.toHaveBeenCalled()
    })
  })

  describe('missing headers', () => {
    it('should handle missing signature header', async () => {
      const body = new URLSearchParams({
        payload: JSON.stringify(mockApprovePayload),
      }).toString()

      const request = new Request('http://localhost:3000/api/slack/interactions', {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'x-slack-request-timestamp': Math.floor(Date.now() / 1000).toString(),
        },
        body,
      })

      mockVerifySlackSignature.mockReturnValue(false)

      const response = await POST(request)

      expect(response.status).toBe(401)
      expect(verifySlackSignature).toHaveBeenCalledWith({
        signature: '',
        timestamp: expect.any(String),
        body,
      })
    })

    it('should handle missing timestamp header', async () => {
      const body = new URLSearchParams({
        payload: JSON.stringify(mockApprovePayload),
      }).toString()

      const request = new Request('http://localhost:3000/api/slack/interactions', {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'x-slack-signature': 'v0=valid',
        },
        body,
      })

      mockVerifySlackSignature.mockReturnValue(false)

      const response = await POST(request)

      expect(response.status).toBe(401)
      expect(verifySlackSignature).toHaveBeenCalledWith({
        signature: 'v0=valid',
        timestamp: '',
        body,
      })
    })
  })

  describe('malformed payload', () => {
    it('should return 200 for malformed JSON payload', async () => {
      const timestamp = Math.floor(Date.now() / 1000).toString()
      const body = new URLSearchParams({
        payload: 'not-valid-json',
      }).toString()

      const request = new Request('http://localhost:3000/api/slack/interactions', {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'x-slack-signature': 'v0=valid',
          'x-slack-request-timestamp': timestamp,
        },
        body,
      })

      mockVerifySlackSignature.mockReturnValue(true)

      const response = await POST(request)

      // Slack expects 200 even on errors to prevent retries
      expect(response.status).toBe(200)
    })
  })
})
