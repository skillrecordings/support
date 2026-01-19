import { randomUUID } from 'crypto'
import {
  ActionsTable,
  ApprovalRequestsTable,
  eq,
  getDb,
} from '@skillrecordings/database'
import { createFrontClient } from '../../front'
import { supportTools } from '../../tools'
import type { ExecutionContext } from '../../tools/types'
import { inngest } from '../client'
import { SUPPORT_ACTION_APPROVED } from '../events'

/**
 * Execute Approved Action Workflow
 *
 * Triggered when a human approves an action via Slack or dashboard.
 * Steps:
 * 1. Look up action record from database
 * 2. Execute the tool with stored parameters
 * 3. Update action status to completed/failed
 *
 * @see Phase 3: HITL Approval Flows
 */
export const executeApprovedAction = inngest.createFunction(
  {
    id: 'execute-approved-action',
    name: 'Execute Approved Action',
  },
  { event: SUPPORT_ACTION_APPROVED },
  async ({ event, step }) => {
    const { actionId, approvedBy, approvedAt } = event.data

    // Step 1: Look up action from database
    const action = await step.run('lookup-action', async () => {
      const db = getDb()
      const [actionRecord] = await db
        .select()
        .from(ActionsTable)
        .where(eq(ActionsTable.id, actionId))

      if (!actionRecord) {
        throw new Error(`Action ${actionId} not found`)
      }

      return actionRecord
    })

    // Step 2: Execute based on action type
    const result = await step.run('execute-action', async () => {
      // Handle draft-response: create draft in Front
      if (action.type === 'draft-response') {
        const params = action.parameters as { response?: string }
        const response = params?.response

        if (!response) {
          return {
            success: false,
            output: null,
            error: 'No response text in draft-response action',
          }
        }

        const frontToken = process.env.FRONT_API_TOKEN
        if (!frontToken) {
          return {
            success: false,
            output: null,
            error: 'FRONT_API_TOKEN not configured',
          }
        }

        const front = createFrontClient(frontToken)
        const conversationId = action.conversation_id
        if (!conversationId) {
          return {
            success: false,
            output: null,
            error: 'No conversation_id in action',
          }
        }

        const draft = await front.createDraft(conversationId, response)
        return {
          success: true,
          output: { draftId: draft.id, conversationId },
          error: undefined,
        }
      }

      // Handle tool execution (processRefund, etc.)
      const params = action.parameters as {
        toolCalls?: Array<{ name: string; args: Record<string, unknown> }>
      }
      const toolCalls = params?.toolCalls || []

      if (toolCalls.length === 0) {
        return {
          success: false,
          output: null,
          error: 'No tool calls found in action parameters',
        }
      }

      // Build execution context
      const executionContext: ExecutionContext = {
        approvalId: actionId,
        traceId: randomUUID(),
        conversationId: action.conversation_id ?? 'unknown',
        user: { id: 'unknown', email: 'unknown' }, // TODO: fetch from conversation context
        purchases: [],
        appConfig: {
          id: action.app_id ?? 'unknown',
          name: action.app_id ?? 'unknown',
        },
      }

      // Execute each tool call
      const results = []
      for (const toolCall of toolCalls) {
        const toolName = toolCall.name as keyof typeof supportTools

        if (toolName === 'processRefund' && supportTools.processRefund) {
          const toolResult = await supportTools.processRefund.execute(
            toolCall.args as {
              purchaseId: string
              appId: string
              reason: string
            },
            executionContext
          )
          results.push({ tool: toolName, result: toolResult })
        } else {
          // Unknown or unsupported tool
          results.push({
            tool: toolName,
            result: {
              success: false,
              error: {
                code: 'UNSUPPORTED_TOOL',
                message: `Tool ${toolName} not supported for post-approval execution`,
              },
            },
          })
        }
      }

      // Aggregate results
      const allSuccessful = results.every((r) => r.result.success)
      return {
        success: allSuccessful,
        output: results,
        error: allSuccessful ? undefined : 'One or more tool executions failed',
      }
    })

    // Step 3: Update action status and approval request
    await step.run('update-action-status', async () => {
      const db = getDb()

      // Update ActionsTable
      await db
        .update(ActionsTable)
        .set({
          executed_at: new Date(),
          result: result.output ? { results: result.output } : null,
          error: result.success
            ? null
            : 'error' in result
              ? result.error
              : 'Unknown error',
        })
        .where(eq(ActionsTable.id, actionId))

      // Update ApprovalRequestsTable status
      await db
        .update(ApprovalRequestsTable)
        .set({
          status: result.success ? 'approved' : 'rejected',
        })
        .where(eq(ApprovalRequestsTable.action_id, actionId))
    })

    return {
      actionId,
      executed: result.success,
      approvedBy,
    }
  }
)
