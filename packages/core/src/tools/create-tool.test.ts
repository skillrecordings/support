import { describe, it, expect, vi, beforeEach } from 'vitest'
import { z } from 'zod'
import { createTool, setAuditHooks } from './create-tool'
import type { ExecutionContext } from './types'

describe('createTool', () => {
	describe('audit logging integration', () => {
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
		})

		it('should log successful tool execution with timing', async () => {
			const onPreExecute = vi.fn()
			const onPostExecute = vi.fn()

			setAuditHooks({
				onPreExecute,
				onPostExecute,
			})

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

			const startTime = Date.now()
			const result = await testTool.execute({ input: 'hello' }, testContext)
			const endTime = Date.now()

			expect(result.success).toBe(true)
			if (result.success) {
				expect(result.data).toEqual({ output: 'HELLO' })
			}

			// Verify pre-execute hook was called
			expect(onPreExecute).toHaveBeenCalledWith({
				toolName: 'test_tool',
				params: { input: 'hello' },
				context: testContext,
			})

			// Verify post-execute hook was called
			expect(onPostExecute).toHaveBeenCalledWith({
				toolName: 'test_tool',
				params: { input: 'hello' },
				result: { output: 'HELLO' },
				context: testContext,
			})

			// Verify hooks were called in order
			const preOrder = onPreExecute.mock.invocationCallOrder[0]
			const postOrder = onPostExecute.mock.invocationCallOrder[0]
			expect(preOrder).toBeDefined()
			expect(postOrder).toBeDefined()
			expect(preOrder!).toBeLessThan(postOrder!)
		})

		it('should log tool execution errors', async () => {
			const onError = vi.fn()

			setAuditHooks({
				onError,
			})

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
			if (!result.success) {
				expect(result.error.code).toBe('EXECUTION_ERROR')
				expect(result.error.message).toBe('Intentional failure')
			}

			// Verify error hook was called
			expect(onError).toHaveBeenCalledWith({
				toolName: 'failing_tool',
				params: { input: 'test' },
				error: expect.any(Error),
				context: testContext,
			})
		})

		it('should not fail execution if audit logging fails', async () => {
			const onPostExecute = vi.fn().mockRejectedValue(new Error('Logging failed'))

			setAuditHooks({
				onPostExecute,
			})

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

			// Tool execution should succeed even if logging fails
			const result = await testTool.execute({ input: 'hello' }, testContext)

			expect(result.success).toBe(true)
			if (result.success) {
				expect(result.data).toEqual({ output: 'HELLO' })
			}
		})

		it('should validate parameters before executing', async () => {
			const onError = vi.fn()

			setAuditHooks({
				onError,
			})

			const testTool = createTool({
				name: 'validated_tool',
				description: 'A tool with validation',
				parameters: z.object({
					email: z.string().email(),
				}),
				execute: async ({ email }) => {
					return { email }
				},
			})

			const result = await testTool.execute({ email: 'invalid-email' }, testContext)

			expect(result.success).toBe(false)
			if (!result.success) {
				expect(result.error.code).toBe('VALIDATION_ERROR')
			}

			// Error hook should be called for validation errors
			expect(onError).toHaveBeenCalled()
		})
	})
})
