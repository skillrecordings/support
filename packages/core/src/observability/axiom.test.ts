import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  initializeAxiom,
  instrumentTool,
  instrumentWebhook,
  withTracing,
} from './axiom'

// Mock @axiomhq/js
const mockIngest = vi.fn()
const mockFlush = vi.fn()

vi.mock('@axiomhq/js', () => ({
  Axiom: vi.fn(() => ({
    ingest: mockIngest,
    flush: mockFlush,
  })),
}))

describe('Axiom Tracing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIngest.mockResolvedValue(undefined)
    mockFlush.mockResolvedValue(undefined)

    // Set up env for tests
    process.env.AXIOM_TOKEN = 'test-token'
    process.env.AXIOM_DATASET = 'support-traces'

    // Initialize client for each test
    initializeAxiom()
  })

  describe('withTracing', () => {
    it('should wrap function execution and send trace to Axiom', async () => {
      const testFn = vi.fn(async () => 'success')
      const attributes = { conversationId: 'conv-123', appId: 'app-456' }

      const result = await withTracing('test-operation', testFn, attributes)

      expect(result).toBe('success')
      expect(testFn).toHaveBeenCalledTimes(1)
      expect(mockIngest).toHaveBeenCalledWith(
        'support-traces',
        expect.objectContaining({
          name: 'test-operation',
          status: 'success',
          conversationId: 'conv-123',
          appId: 'app-456',
        })
      )
    })

    it('should track execution time', async () => {
      const testFn = vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10))
        return 'done'
      })

      await withTracing('slow-operation', testFn)

      expect(mockIngest).toHaveBeenCalledWith(
        'support-traces',
        expect.objectContaining({
          name: 'slow-operation',
          durationMs: expect.any(Number),
        })
      )

      const calls = mockIngest.mock.calls
      expect(calls.length).toBeGreaterThan(0)
      const [, trace] = calls[0]!
      expect(trace.durationMs).toBeGreaterThan(0)
    })

    it('should capture errors and mark status as error', async () => {
      const testError = new Error('Test failure')
      const testFn = vi.fn(async () => {
        throw testError
      })

      await expect(withTracing('failing-operation', testFn)).rejects.toThrow(
        'Test failure'
      )

      expect(mockIngest).toHaveBeenCalledWith(
        'support-traces',
        expect.objectContaining({
          name: 'failing-operation',
          status: 'error',
          error: 'Test failure',
          errorStack: expect.stringContaining('Error: Test failure'),
        })
      )
    })

    it('should merge custom attributes with trace data', async () => {
      const testFn = vi.fn(async () => 'ok')

      await withTracing('custom-attrs', testFn, {
        userId: 'user-789',
        traceId: 'trace-abc',
      })

      expect(mockIngest).toHaveBeenCalledWith(
        'support-traces',
        expect.objectContaining({
          userId: 'user-789',
          traceId: 'trace-abc',
        })
      )
    })
  })

  describe('instrumentWebhook', () => {
    it('should wrap webhook handler with tracing', async () => {
      const handler = vi.fn(async (event: any) => {
        return { status: 'processed', id: event.id }
      })

      const instrumented = instrumentWebhook(handler, 'front-webhook')

      const event = {
        id: 'evt-123',
        conversationId: 'conv-456',
        appId: 'app-789',
      }

      const result = await instrumented(event)

      expect(result).toEqual({ status: 'processed', id: 'evt-123' })
      expect(handler).toHaveBeenCalledWith(event)
      expect(mockIngest).toHaveBeenCalledWith(
        'support-traces',
        expect.objectContaining({
          name: 'webhook.front-webhook',
          conversationId: 'conv-456',
          appId: 'app-789',
          status: 'success',
        })
      )
    })

    it('should extract standard fields from webhook event', async () => {
      const handler = vi.fn(async () => ({ ok: true }))
      const instrumented = instrumentWebhook(handler, 'stripe-webhook')

      await instrumented({
        conversationId: 'conv-xyz',
        appId: 'app-xyz',
        userId: 'user-xyz',
      })

      expect(mockIngest).toHaveBeenCalledWith(
        'support-traces',
        expect.objectContaining({
          conversationId: 'conv-xyz',
          appId: 'app-xyz',
          userId: 'user-xyz',
        })
      )
    })
  })

  describe('instrumentTool', () => {
    it('should wrap tool execution with tracing', async () => {
      const tool = vi.fn(async (args: any) => {
        return { success: true, result: args.input * 2 }
      })

      const instrumented = instrumentTool(tool, 'calculate-refund')

      const result = await instrumented({
        input: 50,
        conversationId: 'conv-111',
        appId: 'app-222',
      })

      expect(result).toEqual({ success: true, result: 100 })
      expect(tool).toHaveBeenCalledWith({
        input: 50,
        conversationId: 'conv-111',
        appId: 'app-222',
      })
      expect(mockIngest).toHaveBeenCalledWith(
        'support-traces',
        expect.objectContaining({
          name: 'tool.calculate-refund',
          conversationId: 'conv-111',
          appId: 'app-222',
          status: 'success',
        })
      )
    })

    it('should handle tool errors gracefully', async () => {
      const tool = vi.fn(async () => {
        throw new Error('Tool failed')
      })

      const instrumented = instrumentTool(tool, 'broken-tool')

      await expect(instrumented({ appId: 'app-333' })).rejects.toThrow(
        'Tool failed'
      )

      expect(mockIngest).toHaveBeenCalledWith(
        'support-traces',
        expect.objectContaining({
          name: 'tool.broken-tool',
          status: 'error',
          error: 'Tool failed',
        })
      )
    })
  })

  describe('initializeAxiom', () => {
    it('should initialize without throwing', () => {
      expect(() => initializeAxiom()).not.toThrow()
    })
  })
})
