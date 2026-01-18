import { inngest } from '../client'
import { SUPPORT_ACTION_APPROVED } from '../events'
import { getDb, ActionsTable, ApprovalRequestsTable, eq } from '@skillrecordings/database'
import { supportTools } from '../../tools'
import type { ExecutionContext } from '../../tools/types'
import { randomUUID } from 'crypto'

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

    // Step 2: Execute the tool with stored parameters
    const result = await step.run('execute-tool', async () => {
      // Extract tool calls from action parameters
      const params = action.parameters as { toolCalls?: Array<{ name: string; args: Record<string, unknown> }> }
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
        conversationId: action.conversation_id,
        user: { id: 'unknown', email: 'unknown' }, // TODO: fetch from conversation context
        purchases: [],
        appConfig: { id: action.app_id, name: action.app_id },
      }

      // Execute each tool call
      const results = []
      for (const toolCall of toolCalls) {
        const toolName = toolCall.name as keyof typeof supportTools

        if (toolName === 'processRefund' && supportTools.processRefund) {
          const toolResult = await supportTools.processRefund.execute(
            toolCall.args as { purchaseId: string; appId: string; reason: string },
            executionContext
          )
          results.push({ tool: toolName, result: toolResult })
        } else {
          // Unknown or unsupported tool
          results.push({
            tool: toolName,
            result: { success: false, error: { code: 'UNSUPPORTED_TOOL', message: `Tool ${toolName} not supported for post-approval execution` } },
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
          result: result.output,
          error: result.success ? null : result.error,
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
