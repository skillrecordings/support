import { z } from 'zod'

/**
 * Tool execution context containing customer and app information
 * available during tool execution.
 */
export interface ToolContext {
  /**
   * Customer information from the current conversation
   */
  user: {
    id: string
    email: string
    name?: string
  }
  /**
   * Customer's purchase history for the app
   */
  purchases: Array<{
    id: string
    productId: string
    purchasedAt: Date
    status: 'active' | 'refunded' | 'cancelled'
    stripeChargeId?: string
  }>
  /**
   * Configuration for the app being supported
   */
  appConfig: {
    id: string
    name: string
    stripeAccountId?: string
  }
}

/**
 * Extended execution context including approval and tracing metadata.
 * Passed to tool execute functions.
 */
export interface ExecutionContext extends ToolContext {
  /**
   * Approval ID if this execution required and received approval
   */
  approvalId?: string
  /**
   * Distributed trace ID for observability
   */
  traceId: string
  /**
   * Conversation ID from Front
   */
  conversationId: string
  /**
   * Database instance for audit logging and data access
   */
  db?: any
}

/**
 * Discriminated union for tool execution results.
 */
export type ToolResult<T> =
  | {
      success: true
      data: T
    }
  | {
      success: false
      error: {
        code: string
        message: string
        details?: unknown
      }
    }

/**
 * Core tool interface for support actions.
 *
 * @typeParam TInput - Input type (what callers pass in)
 * @typeParam TOutput - Output type (after Zod parsing, with defaults applied)
 * @typeParam TResult - Expected result type on success
 */
export interface SupportTool<
  TInput = unknown,
  TOutput = unknown,
  TResult = unknown,
> {
  /**
   * Unique tool identifier (snake_case)
   */
  name: string

  /**
   * Human-readable description for agent context.
   * Should describe when to use this tool and what it does.
   */
  description: string

  /**
   * Zod schema for parameter validation
   */
  parameters: z.ZodType<TOutput, TInput>

  /**
   * Optional approval gate. Return true to require human approval before execution.
   *
   * @param params - Validated/parsed parameters
   * @param context - Tool context with user and purchase info
   * @returns true if approval required, false if auto-approve
   */
  requiresApproval?: (params: TOutput, context: ToolContext) => boolean

  /**
   * Execute the tool action.
   *
   * @param params - Input parameters (will be validated and defaults applied)
   * @param context - Execution context including approval and trace IDs
   * @returns Tool result with success/error discrimination
   */
  execute: (
    params: TInput,
    context: ExecutionContext
  ) => Promise<ToolResult<TResult>>
}

/**
 * Type-safe tool input parameter extraction
 */
export type InferToolInput<T> = T extends SupportTool<infer I, unknown, unknown>
  ? I
  : never

/**
 * Type-safe tool output parameter extraction (after parsing with defaults)
 */
export type InferToolOutput<T> = T extends SupportTool<
  unknown,
  infer O,
  unknown
>
  ? O
  : never

/**
 * Type-safe tool parameter extraction (alias for InferToolInput for backwards compat)
 */
export type InferToolParams<T> = InferToolInput<T>

/**
 * Type-safe tool result extraction
 */
export type InferToolResult<T> = T extends SupportTool<
  unknown,
  unknown,
  infer R
>
  ? R
  : never
