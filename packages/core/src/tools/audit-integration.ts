import { logToolExecution } from '../audit/logger'
import { setAuditHooks } from './create-tool'
import type { ExecutionContext } from './types'

/**
 * Timing tracking for tool executions
 */
const executionTimings = new Map<string, number>()

/**
 * Initialize audit logging integration for all tools.
 * Should be called once during app startup.
 *
 * @example
 * ```typescript
 * import { initializeToolAuditLogging } from '@skillrecordings/core/tools'
 *
 * // In your app initialization
 * initializeToolAuditLogging()
 * ```
 */
export function initializeToolAuditLogging(): void {
	setAuditHooks({
		onPreExecute: async ({ toolName, context }) => {
			const timingKey = `${context.traceId}:${toolName}`
			executionTimings.set(timingKey, Date.now())
		},

		onPostExecute: async ({ toolName, params, result, context }) => {
			if (!context.db) {
				console.warn('[audit-integration] No database instance in context, skipping audit log')
				return
			}

			const timingKey = `${context.traceId}:${toolName}`
			const startTime = executionTimings.get(timingKey)
			const durationMs = startTime ? Date.now() - startTime : 0

			// Clean up timing entry
			executionTimings.delete(timingKey)

			await logToolExecution(context.db, {
				toolName,
				parameters: params as Record<string, unknown>,
				result: result as Record<string, unknown>,
				durationMs,
				traceId: context.traceId,
				conversationId: context.conversationId,
				appId: context.appConfig.id,
			})
		},

		onError: async ({ toolName, params, error, context }) => {
			if (!context.db) {
				console.warn('[audit-integration] No database instance in context, skipping audit log')
				return
			}

			const timingKey = `${context.traceId}:${toolName}`
			const startTime = executionTimings.get(timingKey)
			const durationMs = startTime ? Date.now() - startTime : 0

			// Clean up timing entry
			executionTimings.delete(timingKey)

			await logToolExecution(context.db, {
				toolName,
				parameters: params as Record<string, unknown>,
				error: error.message,
				durationMs,
				traceId: context.traceId,
				conversationId: context.conversationId,
				appId: context.appConfig.id,
			})
		},
	})
}
