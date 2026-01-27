import { randomUUID } from 'crypto'
import {
  ActionsTable,
  ApprovalRequestsTable,
  eq,
  getDb,
} from '@skillrecordings/database'
import { createFrontClient as createFrontSdkClient } from '@skillrecordings/front-sdk'
import { createFrontClient } from '../../front'
import {
  initializeAxiom,
  log,
  traceWorkflowStep,
} from '../../observability/axiom'
import { formatAuditComment } from '../../pipeline/steps/comment'
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

    const workflowStartTime = Date.now()
    initializeAxiom()

    await log('info', 'execute-approved-action workflow started', {
      workflow: 'execute-approved-action',
      actionId,
      approvedBy,
      approvedAt,
    })

    // Step 1: Look up action from database
    const action = await step.run('lookup-action', async () => {
      const stepStartTime = Date.now()

      await log('debug', 'looking up action', {
        workflow: 'execute-approved-action',
        step: 'lookup-action',
        actionId,
      })

      const db = getDb()
      const [actionRecord] = await db
        .select()
        .from(ActionsTable)
        .where(eq(ActionsTable.id, actionId))

      if (!actionRecord) {
        await log('error', 'action not found', {
          workflow: 'execute-approved-action',
          step: 'lookup-action',
          actionId,
        })
        throw new Error(`Action ${actionId} not found`)
      }

      const durationMs = Date.now() - stepStartTime

      await log('info', 'action lookup complete', {
        workflow: 'execute-approved-action',
        step: 'lookup-action',
        actionId,
        actionType: actionRecord.type,
        conversationId: actionRecord.conversation_id,
        appId: actionRecord.app_id,
        durationMs,
      })

      await traceWorkflowStep({
        workflowName: 'execute-approved-action',
        conversationId: actionRecord.conversation_id ?? undefined,
        appId: actionRecord.app_id ?? undefined,
        stepName: 'lookup-action',
        durationMs,
        success: true,
        metadata: { actionType: actionRecord.type },
      })

      return actionRecord
    })

    // Step 2: Execute based on action type
    const result = await step.run('execute-action', async () => {
      const stepStartTime = Date.now()

      await log('debug', 'executing action', {
        workflow: 'execute-approved-action',
        step: 'execute-action',
        actionId,
        actionType: action.type,
        conversationId: action.conversation_id,
      })

      // Handle send-draft (from handle-validated-draft) or draft-response
      if (action.type === 'send-draft' || action.type === 'draft-response') {
        const params = action.parameters as {
          response?: string
          draft?: string // from send-draft action type
          inboxId?: string
          context?: {
            customerEmail?: string
            purchaseCount?: number
            knowledgeCount?: number
            memoryCount?: number
          }
        }
        // Support both 'draft' (from send-draft) and 'response' (from draft-response)
        const response = params?.draft || params?.response

        if (!response) {
          return {
            success: false,
            output: null,
            error: 'No response/draft text in action',
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

        // Get channel ID for creating draft (required by Front API)
        let channelId: string | null = params?.inboxId ?? null // legacy param name
        if (!channelId) {
          // Look up inbox then channel from conversation
          const inboxId = await front.getConversationInbox(conversationId)
          if (inboxId) {
            channelId = await front.getInboxChannel(inboxId)
          }
        }

        if (!channelId) {
          return {
            success: false,
            output: null,
            error: 'Could not determine channel for draft',
          }
        }

        const draft = await front.createDraft(
          conversationId,
          response,
          channelId
        )

        // Add internal comment with context summary for support team
        if (params.context) {
          const ctx = params.context
          const lines = ['🤖 **Agent Context**']
          if (ctx.customerEmail) {
            lines.push(`• Customer: ${ctx.customerEmail}`)
          } else {
            lines.push('• Customer: Not found in system')
          }
          lines.push(`• Purchases: ${ctx.purchaseCount ?? 0}`)
          lines.push(`• Knowledge matches: ${ctx.knowledgeCount ?? 0}`)
          lines.push(`• Memory matches: ${ctx.memoryCount ?? 0}`)

          try {
            await front.addComment(conversationId, lines.join('\n'))
          } catch {
            // Non-fatal - continue even if comment fails
          }
        }

        const durationMs = Date.now() - stepStartTime

        await log('info', 'draft created successfully', {
          workflow: 'execute-approved-action',
          step: 'execute-action',
          actionId,
          conversationId,
          draftId: draft.id,
          durationMs,
        })

        await traceWorkflowStep({
          workflowName: 'execute-approved-action',
          conversationId,
          appId: action.app_id ?? undefined,
          stepName: 'execute-action',
          durationMs,
          success: true,
          metadata: { actionType: action.type, draftId: draft.id },
        })

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
        const toolName = toolCall.name

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
        } else if (toolName === 'assignToInstructor') {
          // Execute instructor assignment via Front SDK
          const args = toolCall.args as {
            conversationId: string
            instructorTeammateId: string
            reason: string
          }

          const frontToken = process.env.FRONT_API_TOKEN
          if (!frontToken) {
            results.push({
              tool: toolName,
              result: {
                success: false,
                error: {
                  code: 'MISSING_CONFIG',
                  message: 'FRONT_API_TOKEN not configured',
                },
              },
            })
            continue
          }

          try {
            // Use SDK directly for updateAssignee (not the deprecated wrapper)
            const front = createFrontSdkClient({ apiToken: frontToken })
            await front.conversations.updateAssignee(
              args.conversationId,
              args.instructorTeammateId
            )
            results.push({
              tool: toolName,
              result: {
                success: true,
                data: {
                  assigned: true,
                  conversationId: args.conversationId,
                  instructorTeammateId: args.instructorTeammateId,
                  reason: args.reason,
                },
              },
            })
          } catch (error) {
            results.push({
              tool: toolName,
              result: {
                success: false,
                error: {
                  code: 'FRONT_API_ERROR',
                  message:
                    error instanceof Error ? error.message : 'Unknown error',
                },
              },
            })
          }
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

    // Step 3: Add audit trail comment for auto-sends
    // Configurable via ENABLE_AUDIT_COMMENTS env var (defaults to true)
    const auditCommentsEnabled = process.env.ENABLE_AUDIT_COMMENTS !== 'false'

    if (
      auditCommentsEnabled &&
      result.success &&
      approvedBy === 'auto' &&
      (action.type === 'send-draft' || action.type === 'draft-response')
    ) {
      await step.run('add-audit-comment', async () => {
        const stepStartTime = Date.now()
        const frontToken = process.env.FRONT_API_TOKEN
        if (!frontToken) {
          await log('warn', 'FRONT_API_TOKEN not set, skipping audit comment', {
            workflow: 'execute-approved-action',
            step: 'add-audit-comment',
            actionId,
            conversationId: action.conversation_id,
          })
          // Non-fatal - skip audit comment if token not configured
          return { added: false, error: 'FRONT_API_TOKEN not configured' }
        }

        const conversationId = action.conversation_id
        if (!conversationId) {
          await log('warn', 'no conversation_id for audit comment', {
            workflow: 'execute-approved-action',
            step: 'add-audit-comment',
            actionId,
          })
          return { added: false, error: 'No conversation_id' }
        }

        try {
          const front = createFrontSdkClient({ apiToken: frontToken })

          // Extract classification data from action parameters
          const params = action.parameters as {
            validationScore?: number
            autoApproved?: boolean
            context?: {
              category?: string
              customerEmail?: string
              confidence?: number
            }
          }

          const category = params.context?.category ?? 'unknown'
          // Use validation score as confidence proxy, or context confidence if available
          const confidence =
            params.context?.confidence ?? params.validationScore ?? 0

          const auditComment = formatAuditComment({
            action: 'auto_sent',
            category,
            confidence,
            timestamp: new Date(),
          })

          await front.conversations.addComment(conversationId, auditComment)

          const durationMs = Date.now() - stepStartTime

          await log('info', 'audit comment added', {
            workflow: 'execute-approved-action',
            step: 'add-audit-comment',
            actionId,
            conversationId,
            category,
            confidence,
            durationMs,
          })

          await traceWorkflowStep({
            workflowName: 'execute-approved-action',
            conversationId,
            appId: action.app_id ?? undefined,
            stepName: 'add-audit-comment',
            durationMs,
            success: true,
            metadata: { category, confidence },
          })

          return { added: true }
        } catch (error) {
          const durationMs = Date.now() - stepStartTime
          const errorMsg =
            error instanceof Error ? error.message : 'Unknown error'

          await log('error', 'audit comment failed', {
            workflow: 'execute-approved-action',
            step: 'add-audit-comment',
            actionId,
            conversationId,
            error: errorMsg,
            durationMs,
          })

          await traceWorkflowStep({
            workflowName: 'execute-approved-action',
            conversationId,
            appId: action.app_id ?? undefined,
            stepName: 'add-audit-comment',
            durationMs,
            success: false,
            error: errorMsg,
          })

          // Non-fatal - continue even if audit comment fails
          return {
            added: false,
            error: errorMsg,
          }
        }
      })
    }

    // Step 4: Update action status and approval request
    await step.run('update-action-status', async () => {
      const stepStartTime = Date.now()

      await log('debug', 'updating action status', {
        workflow: 'execute-approved-action',
        step: 'update-action-status',
        actionId,
        success: result.success,
      })

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

      const durationMs = Date.now() - stepStartTime

      await log('info', 'action status updated', {
        workflow: 'execute-approved-action',
        step: 'update-action-status',
        actionId,
        success: result.success,
        durationMs,
      })

      await traceWorkflowStep({
        workflowName: 'execute-approved-action',
        conversationId: action.conversation_id ?? undefined,
        appId: action.app_id ?? undefined,
        stepName: 'update-action-status',
        durationMs,
        success: true,
      })
    })

    const totalDurationMs = Date.now() - workflowStartTime

    await log('info', 'execute-approved-action workflow completed', {
      workflow: 'execute-approved-action',
      actionId,
      actionType: action.type,
      conversationId: action.conversation_id,
      appId: action.app_id,
      approvedBy,
      executed: result.success,
      error: result.success
        ? undefined
        : 'error' in result
          ? result.error
          : 'Unknown error',
      totalDurationMs,
    })

    await traceWorkflowStep({
      workflowName: 'execute-approved-action',
      conversationId: action.conversation_id ?? undefined,
      appId: action.app_id ?? undefined,
      stepName: 'complete',
      durationMs: totalDurationMs,
      success: result.success,
      metadata: {
        actionType: action.type,
        approvedBy,
        executed: result.success,
      },
    })

    return {
      actionId,
      executed: result.success,
      approvedBy,
    }
  }
)
