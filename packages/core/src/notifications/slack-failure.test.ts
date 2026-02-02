import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type ToolFailureDetails,
  buildFailureBlocks,
  notifyToolFailure,
  sendFailureNotification,
} from './slack-failure'

vi.mock('../slack/client', () => ({
  getSlackClient: vi.fn(),
  postMessage: vi.fn(),
}))

vi.mock('../observability/axiom', () => ({
  log: vi.fn(),
}))

import { postMessage } from '../slack/client'

const mockPostMessage = postMessage as Mock

describe('slack-failure', () => {
  const baseDetails: ToolFailureDetails = {
    actionId: 'act_123',
    conversationId: 'cnv_456',
    appId: 'total-typescript',
    toolName: 'processRefund',
    errorMessage: 'Stripe API error: Card was declined',
    errorCode: 'STRIPE_ERROR',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.SLACK_APPROVAL_CHANNEL = 'C1234567890'
  })

  describe('buildFailureBlocks', () => {
    it('builds basic failure blocks with required fields', () => {
      const blocks = buildFailureBlocks(baseDetails)

      expect(blocks).toBeInstanceOf(Array)
      expect(blocks.length).toBeGreaterThan(0)

      const header = blocks[0]!
      expect(header.type).toBe('header')
      expect((header as any).text.text).toContain('Tool Execution Failed')

      const context = blocks.find(
        (b) =>
          b.type === 'context' &&
          (b as any).elements?.[0]?.text?.includes('App:')
      )
      expect(context).toBeDefined()
      expect((context as any).elements[0].text).toContain('total-typescript')
      expect((context as any).elements[0].text).toContain('processRefund')
      expect((context as any).elements[0].text).toContain('STRIPE ERROR')

      const errorSection = blocks.find(
        (b) =>
          b.type === 'section' &&
          (b as any).text?.text?.includes('Error Message')
      )
      expect(errorSection).toBeDefined()
      expect((errorSection as any).text.text).toContain('Card was declined')

      const actions = blocks.find((b) => b.type === 'actions')
      expect(actions).toBeDefined()
      expect((actions as any).elements[0].url).toBe(
        'https://app.frontapp.com/open/cnv_456'
      )
    })

    it('includes customer email when provided', () => {
      const details: ToolFailureDetails = {
        ...baseDetails,
        customerEmail: 'customer@example.com',
      }

      const blocks = buildFailureBlocks(details)

      const context = blocks.find(
        (b) =>
          b.type === 'context' &&
          (b as any).elements?.[0]?.text?.includes('Customer:')
      )
      expect(context).toBeDefined()
      expect((context as any).elements[0].text).toContain(
        'customer@example.com'
      )
    })

    it('includes approval info when provided', () => {
      const details: ToolFailureDetails = {
        ...baseDetails,
        approvedBy: '@john',
        approvedAt: '2024-02-03T10:30:00Z',
      }

      const blocks = buildFailureBlocks(details)

      const approvalSection = blocks.find(
        (b) =>
          b.type === 'section' && (b as any).text?.text?.includes('Approved by')
      )
      expect(approvalSection).toBeDefined()
      expect((approvalSection as any).text.text).toContain('@john')
      expect((approvalSection as any).text.text).toContain('2024-02-03')
    })

    it('includes sanitized parameters when provided', () => {
      const details: ToolFailureDetails = {
        ...baseDetails,
        parameters: {
          purchaseId: 'pur_789',
          amount: 99.99,
          secretKey: 'sk_test_secret',
          api_key: 'api_key_value',
        },
      }

      const blocks = buildFailureBlocks(details)

      const paramSection = blocks.find(
        (b) =>
          b.type === 'section' && (b as any).text?.text?.includes('Parameters')
      )
      expect(paramSection).toBeDefined()
      const text = (paramSection as any).text.text
      expect(text).toContain('purchaseId')
      expect(text).toContain('pur_789')
      expect(text).toContain('amount')
      expect(text).toContain('99.99')
      expect(text).toContain('[REDACTED]')
      expect(text).not.toContain('sk_test_secret')
      expect(text).not.toContain('api_key_value')
    })

    it('truncates long error messages', () => {
      const longError = 'A'.repeat(600)
      const details: ToolFailureDetails = {
        ...baseDetails,
        errorMessage: longError,
      }

      const blocks = buildFailureBlocks(details)

      const errorSection = blocks.find(
        (b) =>
          b.type === 'section' &&
          (b as any).text?.text?.includes('Error Message')
      )
      const text = (errorSection as any).text.text
      expect(text.length).toBeLessThan(600)
      expect(text).toContain('...')
    })

    it('includes action ID in context', () => {
      const blocks = buildFailureBlocks(baseDetails)

      const actionIdContext = blocks.find(
        (b) =>
          b.type === 'context' &&
          (b as any).elements?.[0]?.text?.includes('Action ID')
      )
      expect(actionIdContext).toBeDefined()
      expect((actionIdContext as any).elements[0].text).toContain('act_123')
    })
  })

  describe('sendFailureNotification', () => {
    it('sends notification successfully', async () => {
      mockPostMessage.mockResolvedValue({
        ts: '1234567890.123456',
        channel: 'C1234567890',
      })

      const result = await sendFailureNotification(baseDetails)

      expect(result.success).toBe(true)
      expect(result.ts).toBe('1234567890.123456')
      expect(result.channel).toBe('C1234567890')

      expect(mockPostMessage).toHaveBeenCalledWith('C1234567890', {
        text: expect.stringContaining('processRefund'),
        blocks: expect.any(Array),
      })
    })

    it('uses custom channel when provided', async () => {
      mockPostMessage.mockResolvedValue({
        ts: '1234567890.123456',
        channel: 'C_CUSTOM',
      })

      await sendFailureNotification(baseDetails, 'C_CUSTOM')

      expect(mockPostMessage).toHaveBeenCalledWith(
        'C_CUSTOM',
        expect.anything()
      )
    })

    it('fails gracefully when channel not configured', async () => {
      delete process.env.SLACK_APPROVAL_CHANNEL

      const result = await sendFailureNotification(baseDetails)

      expect(result.success).toBe(false)
      expect(result.error).toContain('SLACK_APPROVAL_CHANNEL not configured')
      expect(mockPostMessage).not.toHaveBeenCalled()
    })

    it('handles Slack API errors', async () => {
      mockPostMessage.mockRejectedValue(new Error('Slack API rate limited'))

      const result = await sendFailureNotification(baseDetails)

      expect(result.success).toBe(false)
      expect(result.error).toContain('rate limited')
    })
  })

  describe('notifyToolFailure', () => {
    it('sends notification for failed tool result', async () => {
      mockPostMessage.mockResolvedValue({
        ts: '1234567890.123456',
        channel: 'C1234567890',
      })

      const result = await notifyToolFailure({
        actionId: 'act_123',
        conversationId: 'cnv_456',
        appId: 'total-typescript',
        toolName: 'processRefund',
        toolResult: {
          success: false,
          error: {
            code: 'STRIPE_ERROR',
            message: 'Payment failed',
          },
        },
      })

      expect(result.success).toBe(true)
      expect(mockPostMessage).toHaveBeenCalled()
    })

    it('skips notification for successful tool result', async () => {
      const result = await notifyToolFailure({
        actionId: 'act_123',
        conversationId: 'cnv_456',
        appId: 'total-typescript',
        toolName: 'processRefund',
        toolResult: {
          success: true,
        },
      })

      expect(result.success).toBe(true)
      expect(mockPostMessage).not.toHaveBeenCalled()
    })

    it('handles missing error details gracefully', async () => {
      mockPostMessage.mockResolvedValue({
        ts: '1234567890.123456',
        channel: 'C1234567890',
      })

      const result = await notifyToolFailure({
        actionId: 'act_123',
        conversationId: 'cnv_456',
        appId: 'total-typescript',
        toolName: 'processRefund',
        toolResult: {
          success: false,
        },
      })

      expect(result.success).toBe(true)
      expect(mockPostMessage).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          text: expect.stringContaining('unknown error'),
        })
      )
    })

    it('includes optional parameters in notification', async () => {
      mockPostMessage.mockResolvedValue({
        ts: '1234567890.123456',
        channel: 'C1234567890',
      })

      await notifyToolFailure({
        actionId: 'act_123',
        conversationId: 'cnv_456',
        appId: 'total-typescript',
        toolName: 'processRefund',
        toolResult: {
          success: false,
          error: { message: 'Failed' },
        },
        parameters: { purchaseId: 'pur_123' },
        customerEmail: 'test@example.com',
        approvedBy: '@admin',
        approvedAt: '2024-02-03T10:00:00Z',
      })

      expect(mockPostMessage).toHaveBeenCalled()
      const callArgs = mockPostMessage.mock.calls[0]![1] as {
        blocks: unknown[]
      }
      const blocksJson = JSON.stringify(callArgs.blocks)

      expect(blocksJson).toContain('test@example.com')
      expect(blocksJson).toContain('@admin')
      expect(blocksJson).toContain('pur_123')
    })
  })
})
