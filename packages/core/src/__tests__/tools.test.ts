import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { createTool, setAuditHooks } from '../tools'
import type { ExecutionContext } from '../tools'

describe('createTool', () => {
  it('creates a tool with basic configuration', () => {
    const tool = createTool({
      name: 'test_tool',
      description: 'Test tool',
      parameters: z.object({ value: z.string() }),
      execute: async ({ value }) => ({ result: value }),
    })

    expect(tool.name).toBe('test_tool')
    expect(tool.description).toBe('Test tool')
    expect(tool.parameters).toBeDefined()
    expect(tool.execute).toBeDefined()
  })

  it('validates parameters and returns success result', async () => {
    const tool = createTool({
      name: 'lookup_user',
      description: 'Look up user',
      parameters: z.object({
        email: z.string().email(),
      }),
      execute: async ({ email }) => ({ email, found: true }),
    })

    const mockContext: ExecutionContext = {
      user: { id: '1', email: 'test@example.com' },
      purchases: [],
      appConfig: { id: 'app1', name: 'Test App' },
      traceId: 'trace-123',
      conversationId: 'conv-123',
    }

    const result = await tool.execute({ email: 'user@example.com' }, mockContext)

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toEqual({ email: 'user@example.com', found: true })
    }
  })

  it('returns validation error for invalid parameters', async () => {
    const tool = createTool({
      name: 'lookup_user',
      description: 'Look up user',
      parameters: z.object({
        email: z.string().email(),
      }),
      execute: async ({ email }) => ({ email }),
    })

    const mockContext: ExecutionContext = {
      user: { id: '1', email: 'test@example.com' },
      purchases: [],
      appConfig: { id: 'app1', name: 'Test App' },
      traceId: 'trace-123',
      conversationId: 'conv-123',
    }

    const result = await tool.execute({ email: 'not-an-email' } as any, mockContext)

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.code).toBe('VALIDATION_ERROR')
      expect(result.error.message).toBe('Invalid parameters')
    }
  })

  it('returns execution error when tool throws', async () => {
    const tool = createTool({
      name: 'failing_tool',
      description: 'A tool that fails',
      parameters: z.object({}),
      execute: async () => {
        throw new Error('Something went wrong')
      },
    })

    const mockContext: ExecutionContext = {
      user: { id: '1', email: 'test@example.com' },
      purchases: [],
      appConfig: { id: 'app1', name: 'Test App' },
      traceId: 'trace-123',
      conversationId: 'conv-123',
    }

    const result = await tool.execute({}, mockContext)

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.code).toBe('EXECUTION_ERROR')
      expect(result.error.message).toBe('Something went wrong')
    }
  })

  it('supports requiresApproval gate', () => {
    const tool = createTool({
      name: 'refund',
      description: 'Process refund',
      parameters: z.object({ purchaseId: z.string() }),
      requiresApproval: (params, context) => {
        const purchase = context.purchases.find((p) => p.id === params.purchaseId)
        if (!purchase) return true
        const daysSince = (Date.now() - purchase.purchasedAt.getTime()) / (1000 * 60 * 60 * 24)
        return daysSince > 30
      },
      execute: async ({ purchaseId }) => ({ refunded: purchaseId }),
    })

    expect(tool.requiresApproval).toBeDefined()

    const recentPurchase = {
      user: { id: '1', email: 'test@example.com' },
      purchases: [
        {
          id: 'purchase-1',
          productId: 'prod-1',
          purchasedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000), // 10 days ago
          status: 'active' as const,
        },
      ],
      appConfig: { id: 'app1', name: 'Test App' },
    }

    const oldPurchase = {
      ...recentPurchase,
      purchases: [
        {
          ...recentPurchase.purchases[0]!,
          purchasedAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000), // 40 days ago
        },
      ],
    }

    expect(tool.requiresApproval!({ purchaseId: 'purchase-1' }, recentPurchase)).toBe(false)
    expect(tool.requiresApproval!({ purchaseId: 'purchase-1' }, oldPurchase)).toBe(true)
  })

  it('calls audit hooks in order', async () => {
    const calls: string[] = []

    setAuditHooks({
      onPreExecute: async () => {
        calls.push('pre')
      },
      onPostExecute: async () => {
        calls.push('post')
      },
    })

    const tool = createTool({
      name: 'test',
      description: 'Test',
      parameters: z.object({}),
      execute: async () => {
        calls.push('execute')
        return { done: true }
      },
    })

    const mockContext: ExecutionContext = {
      user: { id: '1', email: 'test@example.com' },
      purchases: [],
      appConfig: { id: 'app1', name: 'Test App' },
      traceId: 'trace-123',
      conversationId: 'conv-123',
    }

    await tool.execute({}, mockContext)

    expect(calls).toEqual(['pre', 'execute', 'post'])

    // Clean up
    setAuditHooks({})
  })

  it('calls error hook on failure', async () => {
    let errorCaught = false

    setAuditHooks({
      onError: async () => {
        errorCaught = true
      },
    })

    const tool = createTool({
      name: 'failing',
      description: 'Fails',
      parameters: z.object({}),
      execute: async () => {
        throw new Error('Boom')
      },
    })

    const mockContext: ExecutionContext = {
      user: { id: '1', email: 'test@example.com' },
      purchases: [],
      appConfig: { id: 'app1', name: 'Test App' },
      traceId: 'trace-123',
      conversationId: 'conv-123',
    }

    await tool.execute({}, mockContext)

    expect(errorCaught).toBe(true)

    // Clean up
    setAuditHooks({})
  })
})
