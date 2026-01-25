import { validate } from '../../pipeline/steps/validate'
import type { GatherOutput } from '../../pipeline/types'
import { inngest } from '../client'
import { SUPPORT_DRAFT_CREATED, SUPPORT_DRAFT_VALIDATED } from '../events'

/**
 * Workflow: Validate Draft Response
 *
 * Triggers on support/draft.created and validates the draft content.
 * Checks for internal leaks, meta-commentary, banned phrases, fabrication, etc.
 * Emits support/draft.validated with validation results.
 */
export const validateWorkflow = inngest.createFunction(
  {
    id: 'support-validate',
    name: 'Validate Draft Response',
    retries: 2,
  },
  { event: SUPPORT_DRAFT_CREATED },
  async ({ event, step }) => {
    const { conversationId, messageId, appId, draft, context } = event.data

    console.log('[validate-draft] ========== WORKFLOW STARTED ==========')
    console.log('[validate-draft] Conversation:', conversationId)
    console.log('[validate-draft] Message:', messageId)
    console.log('[validate-draft] App:', appId)

    // Validate the draft
    const validation = await step.run('validate-draft', async () => {
      console.log('[validate-draft] Running validation checks...')

      const result = validate({
        draft: draft.content,
        context: context as GatherOutput,
      })

      console.log('[validate-draft] Validation result:', {
        valid: result.valid,
        issueCount: result.issues.length,
      })

      return result
    })

    // If validation fails badly, we might want to retry drafting or escalate
    // For now, always emit validated event (let approval workflow handle invalid drafts)

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

    console.log('[validate-draft] ========== WORKFLOW COMPLETED ==========')
    console.log('[validate-draft] Valid:', validation.valid)
    console.log('[validate-draft] Issues:', validation.issues.length)

    return { conversationId, messageId, validation }
  }
)
