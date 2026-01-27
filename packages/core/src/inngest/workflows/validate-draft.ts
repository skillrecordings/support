/**
 * Validate Draft Workflow
 *
 * Validates draft responses before sending for approval.
 * Checks for: internal leaks, meta-commentary, banned phrases, fabrication.
 *
 * Epic 1.5 fixes (Boundary 6 from data flow audit):
 * - Forward draft.toolsUsed (was dropped)
 * - Emit structured ValidationIssue objects alongside string[] (was flattened)
 * - Forward full gathered context alongside flattened counts (was counts-only)
 */

import {
  initializeAxiom,
  log,
  traceWorkflowStep,
} from '../../observability/axiom'
import {
  assertDataIntegrity,
  buildDataFlowCheck,
} from '../../pipeline/assert-data-integrity'
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
    const {
      conversationId,
      messageId,
      appId,
      draft,
      context,
      subject,
      body,
      senderEmail,
      classification,
      inboxId,
      traceId,
    } = event.data

    const workflowStartTime = Date.now()
    initializeAxiom()

    // Data flow check: log what we received from draft-response
    await log('info', 'validate workflow started', {
      workflow: 'support-validate',
      conversationId,
      messageId,
      appId,
      traceId,
      draftLength: draft.content.length,
      ...buildDataFlowCheck('support-validate', 'receiving', {
        subject,
        body,
        category: classification?.category,
        confidence: classification?.confidence,
        reasoning: classification?.reasoning,
        draftContent: draft.content,
        signals: classification?.signals,
      }),
    })

    // Assert critical data is present before validation
    await assertDataIntegrity('validate-draft/receive', {
      'draft.content': draft.content,
    })

    const validation = await step.run('validate-draft', async () => {
      const stepStartTime = Date.now()

      await log('debug', 'running validation checks', {
        workflow: 'support-validate',
        step: 'validate-draft',
        conversationId,
        draftLength: draft.content.length,
      })

      // Extract category from classification (preferred) or context fallback
      const category =
        (classification?.category as MessageCategory) ??
        (context as { category?: MessageCategory })?.category

      // Build customer message for relevance checking
      const customerMessage =
        subject || body
          ? { subject: subject ?? '', body: body ?? '' }
          : undefined

      const result = await validate(
        {
          draft: draft.content,
          context: context as GatherOutput,
          customerMessage,
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
        relevanceScore: result.relevance,
        relevanceCheckPerformed: result.relevanceCheckPerformed,
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
          hasRelevance: (issuesByType['relevance'] ?? 0) > 0,
          relevanceScore: result.relevance,
          relevanceCheckPerformed: result.relevanceCheckPerformed,
          draftLength: draft.content.length,
        },
      })

      return result
    })

    // Data flow check: log what we're emitting to handle-validated-draft
    await log('debug', 'emitting draft validated event', {
      workflow: 'support-validate',
      conversationId,
      messageId,
      valid: validation.valid,
      ...buildDataFlowCheck('support-validate', 'emitting', {
        subject,
        body,
        category: classification?.category,
        confidence: classification?.confidence,
        reasoning: classification?.reasoning,
        draftContent: draft.content,
        signals: classification?.signals,
      }),
    })

    await step.sendEvent('emit-validated', {
      name: SUPPORT_DRAFT_VALIDATED,
      data: {
        conversationId,
        messageId,
        appId,
        subject: subject ?? '',
        body: body ?? '',
        senderEmail: senderEmail ?? '',
        relevance: validation.relevance,
        classification: classification ?? {
          category: 'unknown',
          confidence: 0,
          signals: {},
        },
        // Forward full draft object including toolsUsed (was previously dropped)
        draft: {
          content: draft.content,
          toolsUsed: draft.toolsUsed,
        },
        validation: {
          valid: validation.valid,
          // Backward compat: flattened string[] of issue messages
          issues: validation.issues.map((issue) => issue.message),
          // Structured issues with type/severity/match/position for analytics
          structuredIssues: validation.issues.map((issue) => ({
            type: issue.type,
            severity: issue.severity,
            message: issue.message,
            ...(issue.match !== undefined && { match: issue.match }),
            ...(issue.position !== undefined && { position: issue.position }),
          })),
          score: validation.valid ? 1.0 : 0.0,
        },
        // Backward compat: flattened summary context with counts
        context: (() => {
          const ctx = (context ?? {}) as {
            customer?: { email?: string; purchases?: unknown[] }
            knowledge?: unknown[]
            memories?: unknown[]
          }
          return {
            // Audit trail: classification metadata
            category: classification?.category,
            confidence: classification?.confidence,
            reasoning: classification?.reasoning,
            // Original message for potential relevance checking
            subject: subject ?? '',
            body: body ?? '',
            senderEmail: senderEmail ?? '',
            // Customer + context counts for display
            customerEmail: ctx.customer?.email,
            purchaseCount: ctx.customer?.purchases?.length ?? 0,
            knowledgeCount: ctx.knowledge?.length ?? 0,
            memoryCount: ctx.memories?.length ?? 0,
          }
        })(),
        // Full gathered context for downstream (handle-validated-draft, execute)
        // Preserves customer details, knowledge items, memories, history
        gatheredContext: (() => {
          if (!context) return undefined
          const ctx = context as {
            customer?: {
              email: string
              purchases: unknown[]
              trustScore?: number
            } | null
            knowledge?: unknown[]
            memories?: unknown[]
            history?: Array<{ body: string; from: string; date: string }>
            priorConversations?: Array<{
              conversationId: string
              subject: string
              status: string
              lastMessageAt: string
              messageCount: number
              tags: string[]
            }>
          }
          return {
            customer: ctx.customer ?? null,
            knowledge: ctx.knowledge ?? [],
            memories: ctx.memories ?? [],
            history: ctx.history ?? [],
            ...(ctx.priorConversations && {
              priorConversations: ctx.priorConversations,
            }),
          }
        })(),
        inboxId,
        traceId,
      },
    })

    const totalDurationMs = Date.now() - workflowStartTime

    await log('info', 'validate workflow completed', {
      workflow: 'support-validate',
      conversationId,
      messageId,
      appId,
      traceId,
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
