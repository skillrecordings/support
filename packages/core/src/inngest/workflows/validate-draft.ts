/**
 * Validate Draft Workflow
 *
 * Validates draft responses before sending for approval.
 * Checks for: internal leaks, meta-commentary, banned phrases, fabrication, length.
 *
 * Triggered by: support/draft.created
 * Emits: support/draft.validated
 */

import {
  initializeAxiom,
  traceWorkflowStep,
} from '../../observability/axiom'
import { validate } from '../../pipeline/steps/validate'
import type { GatherOutput } from '../../pipeline/types'
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

    // Validate the draft
    const validation = await step.run('validate-draft', async () => {
      const stepStartTime = Date.now()

      const result = validate({
        draft: draft.content,
        context: context as GatherOutput,
      })

      const durationMs = Date.now() - stepStartTime

      // Trace with high cardinality - include each issue type
      const issuesByType: Record<string, number> = {}
      for (const issue of result.issues) {
        issuesByType[issue.type] = (issuesByType[issue.type] ?? 0) + 1
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

    // Emit validated event
    await step.sendEvent('emit-validated', {
      name: SUPPORT_DRAFT_VALIDATED,
      data: {
        conversationId,
        messageId,
        appId,
        draft: {
          content: draft.content,
        },
        validation: {
          valid: validation.valid,
          issues: validation.issues.map((issue) => issue.message),
          score: validation.valid ? 1.0 : 0.0,
        },
      },
    })

    // Final completion trace
    await traceWorkflowStep({
      workflowName: 'support-validate',
      conversationId,
      appId,
      stepName: 'complete',
      durationMs: Date.now() - workflowStartTime,
      success: true,
      metadata: {
        valid: validation.valid,
        issueCount: validation.issues.length,
      },
    })

    return { conversationId, messageId, validation }
  }
)
