// Set environment variables BEFORE any imports
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test'

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { z } from 'zod'

// Mock the audit logger
vi.mock('../audit/logger', () => ({
	logToolExecution: vi.fn().mockResolvedValue({
		id: 'audit-123',
		created_at: new Date(),
	}),
}))

import { initializeToolAuditLogging } from './audit-integration'
import { createTool } from './create-tool'
import type { ExecutionContext } from './types'
import { logToolExecution } from '../audit/logger'

describe('audit-integration', () => {
	const mockDb = {
		insert: vi.fn().mockReturnThis(),
		values: vi.fn().mockResolvedValue(undefined),
		select: vi.fn().mockReturnThis(),
		from: vi.fn().mockReturnThis(),
		where: vi.fn().mockReturnThis(),
		limit: vi.fn().mockResolvedValue([
			{
				id: 'test-audit-id',
				created_at: new Date(),
			},
		]),
	}

	const testContext: ExecutionContext = {
		user: {
			id: 'user-123',
			email: 'test@example.com',
			name: 'Test User',
		},
		purchases: [],
		appConfig: {
			id: 'test-app',
			name: 'Test App',
		},
		traceId: 'trace-123',
		conversationId: 'conv-123',
		db: mockDb as any,
	}

	beforeEach(() => {
		vi.clearAllMocks()
		initializeToolAuditLogging()
	})

	it('should log successful tool execution with duration', async () => {
		const testTool = createTool({
			name: 'test_tool',
			description: 'A test tool',
			parameters: z.object({
				input: z.string(),
			}),
			execute: async ({ input }) => {
				// Simulate some processing time
				await new Promise((resolve) => setTimeout(resolve, 10))
				return { output: input.toUpperCase() }
			},
		})

		const result = await testTool.execute({ input: 'hello' }, testContext)

		expect(result.success).toBe(true)

		// Verify logToolExecution was called
		expect(logToolExecution).toHaveBeenCalledWith(mockDb, {
			toolName: 'test_tool',
			parameters: { input: 'hello' },
			result: { output: 'HELLO' },
			durationMs: expect.any(Number),
			traceId: 'trace-123',
			conversationId: 'conv-123',
			appId: 'test-app',
		})

		// Verify duration was tracked (should be >= 10ms)
		const mockLog = logToolExecution as ReturnType<typeof vi.fn>
		const call = mockLog.mock.calls[0]
		expect(call).toBeDefined()
		expect(call![1].durationMs).toBeGreaterThanOrEqual(10)
	})

	it('should log failed tool execution with error message', async () => {
		const testTool = createTool({
			name: 'failing_tool',
			description: 'A tool that fails',
			parameters: z.object({
				input: z.string(),
			}),
			execute: async () => {
				throw new Error('Intentional failure')
			},
		})

		const result = await testTool.execute({ input: 'test' }, testContext)

		expect(result.success).toBe(false)

		// Verify logToolExecution was called with error
		expect(logToolExecution).toHaveBeenCalledWith(mockDb, {
			toolName: 'failing_tool',
			parameters: { input: 'test' },
			error: 'Intentional failure',
			durationMs: expect.any(Number),
			traceId: 'trace-123',
			conversationId: 'conv-123',
			appId: 'test-app',
		})
	})

	it('should skip logging if db is not in context', async () => {
		const contextWithoutDb: ExecutionContext = {
			...testContext,
			db: undefined,
		}

		const testTool = createTool({
			name: 'test_tool',
			description: 'A test tool',
			parameters: z.object({
				input: z.string(),
			}),
			execute: async ({ input }) => {
				return { output: input.toUpperCase() }
			},
		})

		const result = await testTool.execute({ input: 'hello' }, contextWithoutDb)

		expect(result.success).toBe(true)

		// Verify logToolExecution was NOT called
		expect(logToolExecution).not.toHaveBeenCalled()
	})

	it('should track timing across multiple tool executions', async () => {
		const tool1 = createTool({
			name: 'tool_one',
			description: 'First tool',
			parameters: z.object({}),
			execute: async () => {
				await new Promise((resolve) => setTimeout(resolve, 20))
				return { result: 'one' }
			},
		})

		const tool2 = createTool({
			name: 'tool_two',
			description: 'Second tool',
			parameters: z.object({}),
			execute: async () => {
				await new Promise((resolve) => setTimeout(resolve, 30))
				return { result: 'two' }
			},
		})

		// Execute both tools with different trace IDs
		await tool1.execute({}, { ...testContext, traceId: 'trace-1' })
		await tool2.execute({}, { ...testContext, traceId: 'trace-2' })

		expect(logToolExecution).toHaveBeenCalledTimes(2)

		// Check first call duration
		const mockLog = logToolExecution as ReturnType<typeof vi.fn>
		const call1 = mockLog.mock.calls[0]
		expect(call1).toBeDefined()
		expect(call1![1].toolName).toBe('tool_one')
		expect(call1![1].durationMs).toBeGreaterThanOrEqual(20)

		// Check second call duration
		const call2 = mockLog.mock.calls[1]
		expect(call2).toBeDefined()
		expect(call2![1].toolName).toBe('tool_two')
		expect(call2![1].durationMs).toBeGreaterThanOrEqual(30)
	})
})
