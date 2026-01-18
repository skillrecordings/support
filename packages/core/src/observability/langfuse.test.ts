import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClassifierResult } from '../router/classifier'
import {
  initializeLangfuse,
  traceAgentRun,
  traceClassification,
} from './langfuse'

// Mock langfuse module
const mockTrace = vi.hoisted(() => ({
  id: 'trace-123',
  generation: vi.fn(() => ({
    id: 'gen-456',
  })),
}))

const mockLangfuseClient = vi.hoisted(() => ({
  trace: vi.fn(() => mockTrace),
  shutdown: vi.fn(),
}))

vi.mock('langfuse', () => ({
  Langfuse: vi.fn(() => mockLangfuseClient),
}))

describe('Langfuse LLM Observability', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Set env vars for tests
    process.env.LANGFUSE_PUBLIC_KEY = 'test-public-key'
    process.env.LANGFUSE_SECRET_KEY = 'test-secret-key'
    // Initialize client for each test
    initializeLangfuse()
  })

  describe('traceAgentRun', () => {
    it('should create a trace with conversationId and appId metadata', async () => {
      const agentRun = {
        text: 'Here is my response',
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        finishReason: 'stop' as const,
      }

      const context = {
        conversationId: 'conv-abc',
        appId: 'total-typescript',
        userEmail: '[EMAIL]',
      }

      const result = await traceAgentRun(agentRun, context)

      expect(mockLangfuseClient.trace).toHaveBeenCalledWith({
        name: 'support-agent',
        metadata: {
          conversationId: 'conv-abc',
          appId: 'total-typescript',
          userEmail: '[EMAIL]',
        },
      })

      expect(result).toEqual({
        traceId: 'trace-123',
        generationId: 'gen-456',
      })
    })

    it('should track model, input, output, and token usage', async () => {
      const agentRun = {
        text: 'Response text',
        usage: { promptTokens: 200, completionTokens: 75, totalTokens: 275 },
        finishReason: 'stop' as const,
      }

      const context = {
        conversationId: 'conv-xyz',
        appId: 'pro-tailwind',
        userEmail: '[EMAIL]',
        messages: [
          { role: 'user' as const, content: 'I need help with my purchase' },
        ],
      }

      await traceAgentRun(agentRun, context)

      expect(mockTrace.generation).toHaveBeenCalledWith({
        name: 'agent-reasoning',
        model: expect.stringContaining('claude'),
        input: expect.any(Array),
        output: 'Response text',
        usage: {
          promptTokens: 200,
          completionTokens: 75,
          totalTokens: 275,
        },
        metadata: expect.objectContaining({
          estimatedCostUsd: expect.any(Number),
          finishReason: 'stop',
        }),
      })
    })

    it('should estimate cost based on token usage', async () => {
      const agentRun = {
        text: 'Response',
        usage: { promptTokens: 1000, completionTokens: 500, totalTokens: 1500 },
        finishReason: 'stop' as const,
      }

      const context = {
        conversationId: 'conv-cost',
        appId: 'test-app',
      }

      await traceAgentRun(agentRun, context)

      expect(mockTrace.generation).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            estimatedCostUsd: expect.any(Number),
          }),
        })
      )
    })
  })

  describe('traceClassification', () => {
    it('should create a trace for classification', async () => {
      const input = 'I need a refund please'
      const output: ClassifierResult = {
        category: 'refund',
        confidence: 0.95,
        reasoning: 'Customer explicitly requested refund',
      }
      const usage = { promptTokens: 50, completionTokens: 20, totalTokens: 70 }

      const traceId = await traceClassification(input, output, usage)

      expect(mockLangfuseClient.trace).toHaveBeenCalledWith({
        name: 'classifier',
        metadata: expect.objectContaining({
          category: 'refund',
          confidence: 0.95,
        }),
      })

      expect(traceId).toBe('trace-123')
    })

    it('should track model and token usage for classifier', async () => {
      const input = 'Thank you for your help'
      const output: ClassifierResult = {
        category: 'no_response',
        confidence: 0.88,
        reasoning: 'Polite closing message',
      }
      const usage = { promptTokens: 30, completionTokens: 15, totalTokens: 45 }

      await traceClassification(input, output, usage)

      expect(mockTrace.generation).toHaveBeenCalledWith({
        name: 'classify-message',
        model: 'anthropic/claude-haiku-4-5',
        input,
        output: {
          category: 'no_response',
          confidence: 0.88,
          reasoning: 'Polite closing message',
        },
        usage: {
          promptTokens: 30,
          completionTokens: 15,
          totalTokens: 45,
        },
        metadata: expect.objectContaining({
          estimatedCostUsd: expect.any(Number),
        }),
      })
    })

    it('should include cost estimate for classification', async () => {
      const input = 'Test message'
      const output: ClassifierResult = {
        category: 'general',
        confidence: 0.75,
        reasoning: 'Generic inquiry',
      }
      const usage = { promptTokens: 40, completionTokens: 10, totalTokens: 50 }

      await traceClassification(input, output, usage)

      expect(mockTrace.generation).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            estimatedCostUsd: expect.any(Number),
          }),
        })
      )
    })
  })

  describe('initialization', () => {
    it('should warn if LANGFUSE_PUBLIC_KEY is missing', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      // Clear env vars to trigger warning
      const originalPublicKey = process.env.LANGFUSE_PUBLIC_KEY
      delete process.env.LANGFUSE_PUBLIC_KEY

      // Re-initialize without keys
      initializeLangfuse()

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'LANGFUSE_PUBLIC_KEY or LANGFUSE_SECRET_KEY not set'
        )
      )

      consoleSpy.mockRestore()
      process.env.LANGFUSE_PUBLIC_KEY = originalPublicKey
    })

    it('should not crash if Langfuse is not initialized', async () => {
      // Create a fresh module instance for this test
      vi.resetModules()

      // Set env vars to undefined
      const originalPublicKey = process.env.LANGFUSE_PUBLIC_KEY
      const originalSecretKey = process.env.LANGFUSE_SECRET_KEY
      delete process.env.LANGFUSE_PUBLIC_KEY
      delete process.env.LANGFUSE_SECRET_KEY

      // Re-import to get fresh instance
      const {
        traceAgentRun: freshTraceAgentRun,
        initializeLangfuse: freshInit,
      } = await import('./langfuse')
      freshInit() // Initialize with no keys

      const agentRun = {
        text: 'Test',
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        finishReason: 'stop' as const,
      }

      const context = {
        conversationId: 'test',
        appId: 'test',
      }

      // Should not throw
      const result = await freshTraceAgentRun(agentRun, context)
      expect(result).toEqual({
        traceId: '',
        generationId: '',
      })

      // Restore env vars
      process.env.LANGFUSE_PUBLIC_KEY = originalPublicKey
      process.env.LANGFUSE_SECRET_KEY = originalSecretKey
    })
  })
})
