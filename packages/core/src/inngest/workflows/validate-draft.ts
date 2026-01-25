/**
 * Validate Draft Workflow
 *
 * Validates draft responses before sending for approval.
 * Checks for: internal leaks, meta-commentary, banned phrases, fabrication.
 */

import {
  initializeAxiom,
  log,
  traceWorkflowStep,
} from '../../observability/axiom'
import { type ValidateOptions, validate } from '../../pipeline/steps/validate'
import type { GatherOutput, MessageCategory } from '../../pipeline/types'
import { inngest } from '../client'
import { SUPPORT_DRAFT_CREATED, SUPPORT_DRAFT_VALIDATED } from '../events'

export const validateWorkflow = inngest.createFunction(
  {
    id: 'support-validate',
    name: 'Validate Draft Response',
    retries: 2,
  },
  { event: SUPPORT_DRAFT_CREATED },
  async ({ event, step }) => {
    const { conversationId, messageId, appId, draft, context } = event.data

    const workflowStartTime = Date.now()
    initializeAxiom()

    await log('info', 'validate workflow started', {
      workflow: 'support-validate',
      conversationId,
      messageId,
      appId,
      draftLength: draft.content.length,
    })

    const validation = await step.run('validate-draft', async () => {
      const stepStartTime = Date.now()

      await log('debug', 'running validation checks', {
        workflow: 'support-validate',
        step: 'validate-draft',
        conversationId,
        draftLength: draft.content.length,
      })

      // Extract category from context if available
      const category = (context as { category?: MessageCategory })?.category

      const result = await validate(
        {
          draft: draft.content,
          context: context as GatherOutput,
        },
        {
          appId,
          category,
        }
      )

      const durationMs = Date.now() - stepStartTime

      const issuesByType: Record<string, number> = {}
      for (const issue of result.issues) {
        issuesByType[issue.type] = (issuesByType[issue.type] ?? 0) + 1
      }

      await log('info', 'validation complete', {
        workflow: 'support-validate',
        step: 'validate-draft',
        conversationId,
        appId,
        valid: result.valid,
        issueCount: result.issues.length,
        issueTypes: issuesByType,
        issues: result.issues.map((i) => ({
          type: i.type,
          message: i.message,
        })),
        durationMs,
      })

      if (!result.valid) {
        await log('warn', 'draft validation failed', {
          workflow: 'support-validate',
          conversationId,
          appId,
          issueCount: result.issues.length,
          issueTypes: issuesByType,
          draftPreview: draft.content.slice(0, 200),
        })
      }

      await traceWorkflowStep({
        workflowName: 'support-validate',
        conversationId,
        appId,
        stepName: 'validate',
        durationMs,
        success: result.valid,
        metadata: {
          valid: result.valid,
          issueCount: result.issues.length,
          issueTypes: issuesByType,
          hasLeaks: (issuesByType['leak'] ?? 0) > 0,
          hasMeta: (issuesByType['meta'] ?? 0) > 0,
          hasBanned: (issuesByType['banned'] ?? 0) > 0,
          hasFabrication: (issuesByType['fabrication'] ?? 0) > 0,
          draftLength: draft.content.length,
        },
      })

      return result
    })

    await log('debug', 'emitting draft validated event', {
      workflow: 'support-validate',
      conversationId,
      messageId,
      valid: validation.valid,
    })

    await step.sendEvent('emit-validated', {
      name: SUPPORT_DRAFT_VALIDATED,
      data: {
        conversationId,
        messageId,
        appId,
        draft: { content: draft.content },
        validation: {
          valid: validation.valid,
          issues: validation.issues.map((issue) => issue.message),
          score: validation.valid ? 1.0 : 0.0,
        },
        // Pass context through for internal comments
        // Note: context from gather workflow has shape { customer, knowledge, memories }
        // NOT the internal GatherOutput shape { user, purchases, priorMemory }
        context: context
          ? (() => {
              const ctx = context as {
                customer?: { email?: string; purchases?: unknown[] }
                knowledge?: unknown[]
                memories?: unknown[]
              }
              return {
                customerEmail: ctx.customer?.email,
                purchaseCount: ctx.customer?.purchases?.length ?? 0,
                knowledgeCount: ctx.knowledge?.length ?? 0,
                memoryCount: ctx.memories?.length ?? 0,
              }
            })()
          : undefined,
      },
    })

    const totalDurationMs = Date.now() - workflowStartTime

    await log('info', 'validate workflow completed', {
      workflow: 'support-validate',
      conversationId,
      messageId,
      appId,
      valid: validation.valid,
      issueCount: validation.issues.length,
      totalDurationMs,
    })

    await traceWorkflowStep({
      workflowName: 'support-validate',
      conversationId,
      appId,
      stepName: 'complete',
      durationMs: totalDurationMs,
      success: true,
      metadata: {
        valid: validation.valid,
        issueCount: validation.issues.length,
      },
    })

    return { conversationId, messageId, validation }
  }
)
