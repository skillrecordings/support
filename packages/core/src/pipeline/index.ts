/**
 * Pipeline orchestrator
 *
 * Runs the full classify → route → gather → draft → validate → send pipeline.
 */

import type {
  AppConfig,
  ClassifyOutput,
  CommentOutput,
  DraftOutput,
  GatherOutput,
  PipelineInput,
  PipelineOutput,
  PipelineStepResult,
  RouteOutput,
  ThreadClassifyInput,
  ThreadClassifyOutput,
  ValidateOutput,
} from './types'

import { classify, classifyThread } from './steps/classify'
import { addSupportComment } from './steps/comment'
import { draft } from './steps/draft'
import { formatContextForPrompt, gather } from './steps/gather'
import { route, routeThread, shouldRespond, shouldSilence } from './steps/route'
import { validate } from './steps/validate'

// Re-export types and steps
export * from './types'
export {
  classify,
  extractSignals,
  fastClassify,
  // Thread-aware (v3)
  classifyThread,
  fastClassifyThread,
  llmClassifyThread,
} from './steps/classify'
export {
  route,
  shouldRespond,
  shouldSilence,
  shouldEscalate,
  getRoutingRules,
  // Thread-aware (v3)
  routeThread,
  getThreadRoutingRules,
} from './steps/route'
export { gather, formatContextForPrompt, extractEmail } from './steps/gather'
export {
  draft,
  getPromptForCategory,
  storeDraftCorrection,
  storeDraftSuccess,
  type DraftResult,
  type StoreDraftCorrectionInput,
} from './steps/draft'
export { validate, formatIssues, hasIssueType } from './steps/validate'
// Thread signals (v3)
export {
  computeThreadSignals,
  computeMessageSignals,
  isThreadResolved,
  shouldSupportTeammate,
} from './steps/thread-signals'
// Comment step (v3 - support_teammate action)
export {
  addSupportComment,
  createCommentStep,
  formatSupportComment,
  formatMinimalComment,
} from './steps/comment'

// ============================================================================
// Pipeline configuration
// ============================================================================

export interface PipelineOptions {
  classifyModel?: string
  draftModel?: string
  maxRetries?: number
  validateStrictMode?: boolean
  // Inject tools for gather step
  gatherTools?: import('./steps/gather').GatherTools
  // Inject custom implementations for testing
  gatherFn?: (input: any) => Promise<GatherOutput>
  draftFn?: (input: any) => Promise<DraftOutput>
  sendFn?: (input: any) => Promise<{ sent: boolean; messageId?: string }>
}

// ============================================================================
// Main pipeline
// ============================================================================

export async function runPipeline(
  input: PipelineInput,
  options: PipelineOptions = {}
): Promise<PipelineOutput> {
  const startTime = Date.now()
  const steps: PipelineStepResult[] = []

  let classification: ClassifyOutput | null = null
  let routing: RouteOutput | null = null
  let context: GatherOutput | null = null
  let draftResult: DraftOutput | null = null
  let validation: ValidateOutput | null = null

  // -------------------------------------------------------------------------
  // Step 1: Classify
  // -------------------------------------------------------------------------
  const classifyStart = Date.now()
  try {
    classification = await classify(input.message, {
      model: options.classifyModel,
    })
    steps.push({
      step: 'classify',
      durationMs: Date.now() - classifyStart,
      success: true,
      output: classification,
    })
  } catch (error) {
    steps.push({
      step: 'classify',
      durationMs: Date.now() - classifyStart,
      success: false,
      output: null,
      error: error instanceof Error ? error.message : 'Unknown error',
    })
    return {
      action: 'escalate_human',
      steps,
      totalDurationMs: Date.now() - startTime,
    }
  }

  // -------------------------------------------------------------------------
  // Step 2: Route
  // -------------------------------------------------------------------------
  const routeStart = Date.now()
  try {
    routing = route({
      message: input.message,
      classification,
      appConfig: input.appConfig,
    })
    steps.push({
      step: 'route',
      durationMs: Date.now() - routeStart,
      success: true,
      output: routing,
    })
  } catch (error) {
    steps.push({
      step: 'route',
      durationMs: Date.now() - routeStart,
      success: false,
      output: null,
      error: error instanceof Error ? error.message : 'Unknown error',
    })
    return {
      action: 'escalate_human',
      steps,
      totalDurationMs: Date.now() - startTime,
    }
  }

  // If not responding, stop here
  if (!shouldRespond(routing.action)) {
    return {
      action: routing.action,
      steps,
      totalDurationMs: Date.now() - startTime,
    }
  }

  // -------------------------------------------------------------------------
  // Step 3: Gather
  // -------------------------------------------------------------------------
  const gatherStart = Date.now()
  try {
    if (options.gatherFn) {
      context = await options.gatherFn({
        message: input.message,
        classification,
        appId: input.appConfig.appId,
      })
    } else {
      // Use real gather with provided tools
      context = await gather(
        {
          message: input.message,
          classification,
          appId: input.appConfig.appId,
        },
        { tools: options.gatherTools }
      )
    }
    steps.push({
      step: 'gather',
      durationMs: Date.now() - gatherStart,
      success: true,
      output: {
        hasUser: !!context.user,
        purchaseCount: context.purchases.length,
        knowledgeCount: context.knowledge.length,
        errors: context.gatherErrors.length,
      },
    })
  } catch (error) {
    steps.push({
      step: 'gather',
      durationMs: Date.now() - gatherStart,
      success: false,
      output: null,
      error: error instanceof Error ? error.message : 'Unknown error',
    })
    // Gather failure = escalate, don't expose error
    return {
      action: 'escalate_human',
      steps,
      totalDurationMs: Date.now() - startTime,
    }
  }

  // -------------------------------------------------------------------------
  // Step 4: Draft
  // -------------------------------------------------------------------------
  const draftStart = Date.now()
  try {
    if (options.draftFn) {
      draftResult = await options.draftFn({
        message: input.message,
        classification,
        context,
      })
    } else {
      // Use real draft with LLM
      draftResult = await draft(
        {
          message: input.message,
          classification,
          context,
        },
        { model: options.draftModel }
      )
    }
    steps.push({
      step: 'draft',
      durationMs: Date.now() - draftStart,
      success: true,
      output: {
        draftLength: draftResult.draft.length,
        toolsUsed: draftResult.toolsUsed,
      },
    })
  } catch (error) {
    steps.push({
      step: 'draft',
      durationMs: Date.now() - draftStart,
      success: false,
      output: null,
      error: error instanceof Error ? error.message : 'Unknown error',
    })
    return {
      action: 'escalate_human',
      steps,
      totalDurationMs: Date.now() - startTime,
    }
  }

  // -------------------------------------------------------------------------
  // Step 5: Validate
  // -------------------------------------------------------------------------
  const validateStart = Date.now()
  try {
    validation = validate({
      draft: draftResult.draft,
      context,
      strictMode: options.validateStrictMode,
    })
    steps.push({
      step: 'validate',
      durationMs: Date.now() - validateStart,
      success: true,
      output: {
        valid: validation.valid,
        issueCount: validation.issues.length,
        issues: validation.issues.map((i) => ({
          type: i.type,
          severity: i.severity,
        })),
      },
    })
  } catch (error) {
    steps.push({
      step: 'validate',
      durationMs: Date.now() - validateStart,
      success: false,
      output: null,
      error: error instanceof Error ? error.message : 'Unknown error',
    })
    return {
      action: 'escalate_human',
      steps,
      totalDurationMs: Date.now() - startTime,
    }
  }

  // If validation failed, don't send
  if (!validation.valid) {
    return {
      action: 'escalate_human',
      response: draftResult.draft,
      steps,
      totalDurationMs: Date.now() - startTime,
    }
  }

  // -------------------------------------------------------------------------
  // Step 6: Send (if not dry run)
  // -------------------------------------------------------------------------
  if (input.dryRun) {
    return {
      action: 'respond',
      response: draftResult.draft,
      sent: false,
      steps,
      totalDurationMs: Date.now() - startTime,
    }
  }

  const sendStart = Date.now()
  try {
    if (options.sendFn) {
      const sendResult = await options.sendFn({
        conversationId: input.message.conversationId,
        draft: draftResult.draft,
        appId: input.appConfig.appId,
      })
      steps.push({
        step: 'send',
        durationMs: Date.now() - sendStart,
        success: sendResult.sent,
        output: { messageId: sendResult.messageId },
      })
      return {
        action: 'respond',
        response: draftResult.draft,
        sent: sendResult.sent,
        messageId: sendResult.messageId,
        steps,
        totalDurationMs: Date.now() - startTime,
      }
    } else {
      // No send function = dry run
      steps.push({
        step: 'send',
        durationMs: 0,
        success: true,
        output: { skipped: true },
      })
      return {
        action: 'respond',
        response: draftResult.draft,
        sent: false,
        steps,
        totalDurationMs: Date.now() - startTime,
      }
    }
  } catch (error) {
    steps.push({
      step: 'send',
      durationMs: Date.now() - sendStart,
      success: false,
      output: null,
      error: error instanceof Error ? error.message : 'Unknown error',
    })
    return {
      action: 'escalate_human',
      response: draftResult.draft,
      steps,
      totalDurationMs: Date.now() - startTime,
    }
  }
}

// ============================================================================
// Thread-aware pipeline (v3)
// ============================================================================

export interface ThreadPipelineInput {
  thread: ThreadClassifyInput
  appConfig: AppConfig
  dryRun?: boolean
}

export interface ThreadPipelineOptions extends PipelineOptions {
  /** Front API token for comment step */
  frontApiToken?: string
  /** Comment author teammate ID */
  commentAuthorId?: string
}

/**
 * Run the thread-aware pipeline.
 *
 * Handles new actions like support_teammate (adds comment instead of draft).
 */
export async function runThreadPipeline(
  input: ThreadPipelineInput,
  options: ThreadPipelineOptions = {}
): Promise<PipelineOutput> {
  const startTime = Date.now()
  const steps: PipelineStepResult[] = []

  let classification: ThreadClassifyOutput | null = null
  let routing: RouteOutput | null = null
  let context: GatherOutput | null = null
  let draftResult: DraftOutput | null = null
  let validation: ValidateOutput | null = null
  let commentResult: CommentOutput | null = null

  // -------------------------------------------------------------------------
  // Step 1: Classify (thread-aware)
  // -------------------------------------------------------------------------
  const classifyStart = Date.now()
  try {
    classification = await classifyThread(input.thread, {
      model: options.classifyModel,
    })
    steps.push({
      step: 'classify',
      durationMs: Date.now() - classifyStart,
      success: true,
      output: {
        category: classification.category,
        confidence: classification.confidence,
        threadLength: classification.signals.threadLength,
        hasTeammate: classification.signals.hasTeammateMessage,
      },
    })
  } catch (error) {
    steps.push({
      step: 'classify',
      durationMs: Date.now() - classifyStart,
      success: false,
      output: null,
      error: error instanceof Error ? error.message : 'Unknown error',
    })
    return {
      action: 'escalate_human',
      steps,
      totalDurationMs: Date.now() - startTime,
    }
  }

  // -------------------------------------------------------------------------
  // Step 2: Route (thread-aware)
  // -------------------------------------------------------------------------
  const routeStart = Date.now()
  try {
    routing = routeThread({
      classification,
      appConfig: input.appConfig,
    })
    steps.push({
      step: 'route',
      durationMs: Date.now() - routeStart,
      success: true,
      output: routing,
    })
  } catch (error) {
    steps.push({
      step: 'route',
      durationMs: Date.now() - routeStart,
      success: false,
      output: null,
      error: error instanceof Error ? error.message : 'Unknown error',
    })
    return {
      action: 'escalate_human',
      steps,
      totalDurationMs: Date.now() - startTime,
    }
  }

  // If not responding AND not support_teammate, stop here
  if (!shouldRespond(routing.action) && routing.action !== 'support_teammate') {
    return {
      action: routing.action,
      steps,
      totalDurationMs: Date.now() - startTime,
    }
  }

  // -------------------------------------------------------------------------
  // Step 3: Gather (needed for both respond and support_teammate)
  // -------------------------------------------------------------------------
  const gatherStart = Date.now()
  try {
    // Convert thread trigger to single message format for gather
    const triggerAsMessage = {
      subject: input.thread.triggerMessage.subject || '',
      body: input.thread.triggerMessage.body,
      from: input.thread.triggerMessage.author?.email,
      conversationId: input.thread.conversationId,
      appId: input.thread.appId,
    }

    if (options.gatherFn) {
      context = await options.gatherFn({
        message: triggerAsMessage,
        classification: {
          category: classification.category,
          confidence: classification.confidence,
          signals: classification.signals, // ThreadSignals extends MessageSignals
          reasoning: classification.reasoning,
        },
        appId: input.appConfig.appId,
      })
    } else {
      context = await gather(
        {
          message: triggerAsMessage,
          classification: {
            category: classification.category,
            confidence: classification.confidence,
            signals: classification.signals,
            reasoning: classification.reasoning,
          },
          appId: input.appConfig.appId,
        },
        { tools: options.gatherTools }
      )
    }
    steps.push({
      step: 'gather',
      durationMs: Date.now() - gatherStart,
      success: true,
      output: {
        hasUser: !!context.user,
        purchaseCount: context.purchases.length,
        knowledgeCount: context.knowledge.length,
        errors: context.gatherErrors.length,
      },
    })
  } catch (error) {
    steps.push({
      step: 'gather',
      durationMs: Date.now() - gatherStart,
      success: false,
      output: null,
      error: error instanceof Error ? error.message : 'Unknown error',
    })
    return {
      action: 'escalate_human',
      steps,
      totalDurationMs: Date.now() - startTime,
    }
  }

  // -------------------------------------------------------------------------
  // Branch: support_teammate → add comment
  // -------------------------------------------------------------------------
  if (routing.action === 'support_teammate') {
    if (!input.dryRun && options.frontApiToken) {
      const commentStart = Date.now()
      try {
        commentResult = await addSupportComment(
          {
            conversationId: input.thread.conversationId,
            context,
            appId: input.appConfig.appId,
          },
          {
            frontApiToken: options.frontApiToken,
            authorId: options.commentAuthorId,
          }
        )
        steps.push({
          step: 'send', // Reuse send step name for simplicity
          durationMs: Date.now() - commentStart,
          success: commentResult.added,
          output: { type: 'comment', added: commentResult.added },
        })
      } catch (error) {
        steps.push({
          step: 'send',
          durationMs: Date.now() - commentStart,
          success: false,
          output: null,
          error: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    }

    return {
      action: 'support_teammate',
      steps,
      totalDurationMs: Date.now() - startTime,
    }
  }

  // -------------------------------------------------------------------------
  // Step 4: Draft (only for respond action)
  // -------------------------------------------------------------------------
  const draftStart = Date.now()
  try {
    const triggerAsMessage = {
      subject: input.thread.triggerMessage.subject || '',
      body: input.thread.triggerMessage.body,
      from: input.thread.triggerMessage.author?.email,
      conversationId: input.thread.conversationId,
      appId: input.thread.appId,
    }

    if (options.draftFn) {
      draftResult = await options.draftFn({
        message: triggerAsMessage,
        classification,
        context,
      })
    } else {
      draftResult = await draft(
        {
          message: triggerAsMessage,
          classification: {
            category: classification.category,
            confidence: classification.confidence,
            signals: classification.signals,
            reasoning: classification.reasoning,
          },
          context,
        },
        { model: options.draftModel }
      )
    }
    steps.push({
      step: 'draft',
      durationMs: Date.now() - draftStart,
      success: true,
      output: {
        draftLength: draftResult.draft.length,
        toolsUsed: draftResult.toolsUsed,
      },
    })
  } catch (error) {
    steps.push({
      step: 'draft',
      durationMs: Date.now() - draftStart,
      success: false,
      output: null,
      error: error instanceof Error ? error.message : 'Unknown error',
    })
    return {
      action: 'escalate_human',
      steps,
      totalDurationMs: Date.now() - startTime,
    }
  }

  // -------------------------------------------------------------------------
  // Step 5: Validate
  // -------------------------------------------------------------------------
  const validateStart = Date.now()
  try {
    validation = validate({
      draft: draftResult.draft,
      context,
      strictMode: options.validateStrictMode,
    })
    steps.push({
      step: 'validate',
      durationMs: Date.now() - validateStart,
      success: true,
      output: {
        valid: validation.valid,
        issueCount: validation.issues.length,
        issues: validation.issues.map((i) => ({
          type: i.type,
          severity: i.severity,
        })),
      },
    })
  } catch (error) {
    steps.push({
      step: 'validate',
      durationMs: Date.now() - validateStart,
      success: false,
      output: null,
      error: error instanceof Error ? error.message : 'Unknown error',
    })
    return {
      action: 'escalate_human',
      steps,
      totalDurationMs: Date.now() - startTime,
    }
  }

  if (!validation.valid) {
    return {
      action: 'escalate_human',
      response: draftResult.draft,
      steps,
      totalDurationMs: Date.now() - startTime,
    }
  }

  // -------------------------------------------------------------------------
  // Step 6: Send (if not dry run)
  // -------------------------------------------------------------------------
  if (input.dryRun) {
    return {
      action: 'respond',
      response: draftResult.draft,
      sent: false,
      steps,
      totalDurationMs: Date.now() - startTime,
    }
  }

  const sendStart = Date.now()
  try {
    if (options.sendFn) {
      const sendResult = await options.sendFn({
        conversationId: input.thread.conversationId,
        draft: draftResult.draft,
        appId: input.appConfig.appId,
      })
      steps.push({
        step: 'send',
        durationMs: Date.now() - sendStart,
        success: sendResult.sent,
        output: { messageId: sendResult.messageId },
      })
      return {
        action: 'respond',
        response: draftResult.draft,
        sent: sendResult.sent,
        messageId: sendResult.messageId,
        steps,
        totalDurationMs: Date.now() - startTime,
      }
    } else {
      steps.push({
        step: 'send',
        durationMs: 0,
        success: true,
        output: { skipped: true },
      })
      return {
        action: 'respond',
        response: draftResult.draft,
        sent: false,
        steps,
        totalDurationMs: Date.now() - startTime,
      }
    }
  } catch (error) {
    steps.push({
      step: 'send',
      durationMs: Date.now() - sendStart,
      success: false,
      output: null,
      error: error instanceof Error ? error.message : 'Unknown error',
    })
    return {
      action: 'escalate_human',
      response: draftResult.draft,
      steps,
      totalDurationMs: Date.now() - startTime,
    }
  }
}
