import { z } from 'zod'
import type {
  ExecutionContext,
  SupportTool,
  ToolContext,
  ToolResult,
} from './types'

/**
 * Configuration for creating a support tool.
 *
 * @typeParam TInput - Input type (what callers pass in)
 * @typeParam TOutput - Output type (after Zod parsing, with defaults applied)
 * @typeParam TResult - Tool result type
 */
export interface CreateToolConfig<TInput, TOutput, TResult> {
  /**
   * Unique tool identifier (snake_case)
   */
  name: string

  /**
   * Human-readable description for agent context
   */
  description: string

  /**
   * Zod schema for parameter validation
   */
  parameters: z.ZodType<TOutput, TInput>

  /**
   * Optional approval gate (receives parsed/validated params)
   */
  requiresApproval?: (params: TOutput, context: ToolContext) => boolean

  /**
   * Tool execution function (receives parsed/validated params)
   */
  execute: (params: TOutput, context: ExecutionContext) => Promise<TResult>
}

/**
 * Audit logging hooks
 */
export interface AuditHooks {
  /**
   * Called before tool execution
   */
  onPreExecute?: (config: {
    toolName: string
    params: unknown
    context: ExecutionContext
  }) => Promise<void> | void

  /**
   * Called after successful execution
   */
  onPostExecute?: (config: {
    toolName: string
    params: unknown
    result: unknown
    context: ExecutionContext
  }) => Promise<void> | void

  /**
   * Called on execution error
   */
  onError?: (config: {
    toolName: string
    params: unknown
    error: Error
    context: ExecutionContext
  }) => Promise<void> | void
}

/**
 * Global audit hooks registry
 */
let globalAuditHooks: AuditHooks = {}

/**
 * Register global audit hooks for all tools.
 *
 * @param hooks - Audit logging callbacks
 */
export function setAuditHooks(hooks: AuditHooks): void {
  globalAuditHooks = hooks
}

/**
 * Create a type-safe support tool with parameter validation and error handling.
 *
 * @param config - Tool configuration
 * @returns Wrapped SupportTool with validation and audit logging
 *
 * @example
 * ```typescript
 * const lookupUser = createTool({
 *   name: 'lookup_user',
 *   description: 'Look up user by email',
 *   parameters: z.object({
 *     email: z.string().email(),
 *     appId: z.string(),
 *   }),
 *   execute: async ({ email, appId }) => {
 *     const app = await appRegistry.get(appId)
 *     return app.integration.lookupUser(email)
 *   },
 * })
 * ```
 */
export function createTool<TInput, TOutput, TResult>(
  config: CreateToolConfig<TInput, TOutput, TResult>
): SupportTool<TInput, TOutput, TResult> {
  return {
    name: config.name,
    description: config.description,
    parameters: config.parameters,
    requiresApproval: config.requiresApproval,

    execute: async (
      params: TInput,
      context: ExecutionContext
    ): Promise<ToolResult<TResult>> => {
      try {
        // Validate parameters
        const validatedParams = config.parameters.parse(params)

        // Pre-execution hook (swallow errors to prevent audit failures from blocking execution)
        try {
          await globalAuditHooks.onPreExecute?.({
            toolName: config.name,
            params: validatedParams,
            context,
          })
        } catch (hookError) {
          console.error(
            '[create-tool] Pre-execution audit hook failed:',
            hookError
          )
        }

        // Execute tool
        const result = await config.execute(validatedParams, context)

        // Post-execution hook (swallow errors to prevent audit failures from blocking execution)
        try {
          await globalAuditHooks.onPostExecute?.({
            toolName: config.name,
            params: validatedParams,
            result,
            context,
          })
        } catch (hookError) {
          console.error(
            '[create-tool] Post-execution audit hook failed:',
            hookError
          )
        }

        return {
          success: true,
          data: result,
        }
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error))

        // Error hook (swallow errors to prevent audit failures from blocking execution)
        try {
          await globalAuditHooks.onError?.({
            toolName: config.name,
            params,
            error: err,
            context,
          })
        } catch (hookError) {
          console.error('[create-tool] Error audit hook failed:', hookError)
        }

        // Handle Zod validation errors specifically
        if (error instanceof z.ZodError) {
          return {
            success: false,
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Invalid parameters',
              details: error.format(),
            },
          }
        }

        // Generic error response
        return {
          success: false,
          error: {
            code: 'EXECUTION_ERROR',
            message: err.message,
            details: err.stack,
          },
        }
      }
    },
  }
}
