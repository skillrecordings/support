import {
	AuditLogTable,
	type NewAuditLog,
	type AuditLog,
	eq,
	and,
	desc,
} from '@skillrecordings/database'

/**
 * Token usage metrics for LLM operations
 */
export interface TokenUsage {
	input: number
	output: number
}

/**
 * Parameters for logging a tool execution
 */
export interface LogToolExecutionParams {
	toolName: string
	parameters: Record<string, unknown>
	result?: Record<string, unknown>
	error?: string
	durationMs: number
	tokenUsage?: TokenUsage
	traceId: string
	conversationId?: string
	appId?: string
}

/**
 * Parameters for logging an agent run
 */
export interface LogAgentRunParams {
	conversationId: string
	appId: string
	tokenUsage?: TokenUsage
	durationMs: number
	traceId: string
}

/**
 * Parameters for querying audit trail
 */
export interface GetAuditTrailParams {
	conversationId?: string
	traceId?: string
	limit?: number
}

/**
 * Log a tool execution to the audit trail.
 *
 * Records all details about a tool execution including parameters, results, errors,
 * timing, and token usage. Errors during logging are caught and logged to console
 * to prevent cascading failures.
 *
 * @param db - Drizzle database instance
 * @param params - Tool execution details
 * @returns The created audit log record, or null if logging failed
 *
 * @example
 * ```typescript
 * const record = await logToolExecution(db, {
 *   toolName: 'lookup_user',
 *   parameters: { email: '[EMAIL]' },
 *   result: { id: '123', email: '[EMAIL]' },
 *   durationMs: 245,
 *   traceId: 'trace-abc',
 *   conversationId: 'cnv_123',
 *   appId: 'total-typescript'
 * })
 * ```
 */
export async function logToolExecution(
	db: any,
	params: LogToolExecutionParams,
): Promise<AuditLog | null> {
	try {
		const id = crypto.randomUUID()
		const newRecord: NewAuditLog = {
			id,
			conversation_id: params.conversationId ?? null,
			app_id: params.appId ?? null,
			action_type: 'tool_execution',
			tool_name: params.toolName,
			parameters: params.parameters,
			result: params.result ?? null,
			error: params.error ?? null,
			duration_ms: params.durationMs,
			token_usage: params.tokenUsage ?? null,
			trace_id: params.traceId,
		}

		await db.insert(AuditLogTable).values(newRecord)
		const records = await db
			.select()
			.from(AuditLogTable)
			.where(eq(AuditLogTable.id, id))
			.limit(1)

		return records[0] ?? null
	} catch (error) {
		console.error('[audit-logger] Failed to log tool execution:', error)
		return null
	}
}

/**
 * Log a complete agent run to the audit trail.
 *
 * Records high-level metrics about an entire agent execution including total
 * token usage and duration. Use this for tracking overall agent performance
 * and resource consumption.
 *
 * @param db - Drizzle database instance
 * @param params - Agent run details
 * @returns The created audit log record, or null if logging failed
 *
 * @example
 * ```typescript
 * const record = await logAgentRun(db, {
 *   conversationId: 'cnv_123',
 *   appId: 'total-typescript',
 *   tokenUsage: { input: 1500, output: 500 },
 *   durationMs: 3200,
 *   traceId: 'trace-abc'
 * })
 * ```
 */
export async function logAgentRun(
	db: any,
	params: LogAgentRunParams,
): Promise<AuditLog | null> {
	try {
		const id = crypto.randomUUID()
		const newRecord: NewAuditLog = {
			id,
			conversation_id: params.conversationId,
			app_id: params.appId,
			action_type: 'agent_run',
			tool_name: null,
			parameters: {},
			result: null,
			error: null,
			duration_ms: params.durationMs,
			token_usage: params.tokenUsage ?? null,
			trace_id: params.traceId,
		}

		await db.insert(AuditLogTable).values(newRecord)
		const records = await db
			.select()
			.from(AuditLogTable)
			.where(eq(AuditLogTable.id, id))
			.limit(1)

		return records[0] ?? null
	} catch (error) {
		console.error('[audit-logger] Failed to log agent run:', error)
		return null
	}
}

/**
 * Query the audit trail with optional filters.
 *
 * Retrieves audit log entries filtered by conversation ID, trace ID, or both.
 * Results are ordered by creation time (newest first) and can be limited.
 *
 * @param db - Drizzle database instance
 * @param params - Query filters and options
 * @returns Array of matching audit log records
 *
 * @example
 * ```typescript
 * // Get all logs for a conversation
 * const logs = await getAuditTrail(db, {
 *   conversationId: 'cnv_123',
 *   limit: 50
 * })
 *
 * // Get all logs for a specific trace
 * const traceLogs = await getAuditTrail(db, {
 *   traceId: 'trace-abc'
 * })
 * ```
 */
export async function getAuditTrail(
	db: any,
	params: GetAuditTrailParams = {},
): Promise<AuditLog[]> {
	try {
		// Build where conditions
		const conditions = []
		if (params.conversationId) {
			conditions.push(eq(AuditLogTable.conversation_id, params.conversationId))
		}
		if (params.traceId) {
			conditions.push(eq(AuditLogTable.trace_id, params.traceId))
		}

		// Build query
		let query = db.select().from(AuditLogTable)

		if (conditions.length > 0) {
			query = query.where(conditions.length === 1 ? conditions[0] : and(...conditions))
		}

		// Apply limit and ordering (newest first)
		const limit = params.limit ?? 100
		const results = await query.orderBy(desc(AuditLogTable.created_at)).limit(limit)

		return results
	} catch (error) {
		console.error('[audit-logger] Failed to query audit trail:', error)
		return []
	}
}
