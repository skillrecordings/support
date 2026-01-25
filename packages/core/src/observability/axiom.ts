/**
 * Axiom tracing instrumentation for observability
 *
 * Wraps webhook handlers, agent runs, tool executions, and Inngest steps
 * with distributed tracing. Tracks conversationId, appId, traceId, userId.
 */

import { Axiom } from '@axiomhq/js'
import type {
  InstrumentedHandler,
  InstrumentedTool,
  TraceAttributes,
} from './types'

let axiomClient: Axiom | null = null

/**
 * Initialize Axiom client (call once at app startup)
 */
export function initializeAxiom(): void {
  const token = process.env.AXIOM_TOKEN
  const dataset = process.env.AXIOM_DATASET || 'support-traces'

  if (!token) {
    console.warn('[Axiom] AXIOM_TOKEN not set, tracing disabled')
    return
  }

  axiomClient = new Axiom({ token })
}

/**
 * Wrap a function execution with tracing
 */
export async function withTracing<T>(
  name: string,
  fn: () => Promise<T>,
  attributes?: TraceAttributes
): Promise<T> {
  const startTime = Date.now()

  try {
    const result = await fn()
    const endTime = Date.now()

    await sendTrace({
      name,
      status: 'success',
      durationMs: endTime - startTime,
      ...attributes,
    })

    return result
  } catch (error) {
    const endTime = Date.now()

    await sendTrace({
      name,
      status: 'error',
      durationMs: endTime - startTime,
      error: error instanceof Error ? error.message : String(error),
      errorStack: error instanceof Error ? error.stack : undefined,
      ...attributes,
    })

    throw error
  }
}

/**
 * Instrument a webhook handler with automatic tracing
 */
export function instrumentWebhook<TEvent, TResult>(
  handler: (event: TEvent) => Promise<TResult>,
  webhookName: string
): InstrumentedHandler<TEvent, TResult> {
  return async (event: TEvent) => {
    // Extract common fields from event
    const attributes = extractAttributes(event)

    return withTracing(
      `webhook.${webhookName}`,
      () => handler(event),
      attributes
    )
  }
}

/**
 * Instrument a tool execution with automatic tracing
 */
export function instrumentTool<TArgs, TResult>(
  tool: (args: TArgs) => Promise<TResult>,
  toolName: string
): InstrumentedTool<TArgs, TResult> {
  return async (args: TArgs) => {
    // Extract common fields from args
    const attributes = extractAttributes(args)

    return withTracing(`tool.${toolName}`, () => tool(args), attributes)
  }
}

/**
 * Extract standard trace attributes from event/args
 */
function extractAttributes(data: any): TraceAttributes {
  const attributes: TraceAttributes = {}

  if (data && typeof data === 'object') {
    if (data.conversationId)
      attributes.conversationId = String(data.conversationId)
    if (data.appId) attributes.appId = String(data.appId)
    if (data.traceId) attributes.traceId = String(data.traceId)
    if (data.userId) attributes.userId = String(data.userId)
  }

  return attributes
}

/**
 * Send trace data to Axiom
 */
async function sendTrace(trace: Record<string, any>): Promise<void> {
  if (!axiomClient) {
    // Silently skip if not initialized (e.g., in dev without AXIOM_TOKEN)
    return
  }

  const dataset = process.env.AXIOM_DATASET || 'support-traces'

  try {
    await axiomClient.ingest(dataset, {
      _time: new Date().toISOString(),
      ...trace,
    })
  } catch (error) {
    // Don't throw - observability failures shouldn't crash the app
    console.error('[Axiom] Failed to send trace:', error)
  }
}

// ============================================================================
// Generic logging
// ============================================================================

/**
 * Log a message to Axiom with optional metadata.
 * Use for debug/info logging that should go to Axiom instead of console.
 */
export async function log(
  level: 'debug' | 'info' | 'warn' | 'error',
  message: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  await sendTrace({
    name: 'log',
    type: 'log',
    level,
    message,
    ...metadata,
  })
}

// ============================================================================
// Rich trace functions with high cardinality
// ============================================================================

/**
 * Trace a classification result
 */
export async function traceClassification(data: {
  conversationId: string
  appId: string
  messageId: string
  category: string
  complexity: string
  confidence: number
  reasoning: string
  messageLength: number
  durationMs: number
  usage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
}): Promise<void> {
  await sendTrace({
    name: 'classifier.run',
    type: 'classification',
    ...data,
  })
}

/**
 * Trace an agent run - high cardinality for analytics
 */
export async function traceAgentRun(data: {
  conversationId: string
  appId: string
  messageId: string
  model: string
  responseLength: number
  toolCallsCount: number
  toolNames: string[]
  requiresApproval: boolean
  autoSent: boolean
  escalated: boolean
  durationMs: number
  memoriesRetrieved: number
  knowledgeResults: number
  customerEmail?: string
  // High cardinality fields for analytics
  category?: string
  confidence?: number
  complexity?: string
  trustScore?: number
  inputLength?: number
  conversationLength?: number
  knowledgeEmpty?: boolean
  escalationReason?: string
  inboxId?: string
}): Promise<void> {
  await sendTrace({
    name: 'agent.run',
    type: 'agent',
    ...data,
  })
}

/**
 * Trace a routing decision
 */
export async function traceRouting(data: {
  conversationId: string
  appId: string
  messageId: string
  routingType:
    | 'filtered'
    | 'skipped'
    | 'loop-prevented'
    | 'escalated'
    | 'approval-requested'
    | 'response-ready'
    | 'instructor-approval-requested'
    | 'no-instructor-configured'
    | 'team-correspondence'
  filterRuleId?: string
  loopReason?: string
  escalationReason?: string
  actionId?: string
}): Promise<void> {
  await sendTrace({
    name: 'router.decision',
    type: 'routing',
    ...data,
  })
}

/**
 * Trace memory retrieval
 */
export async function traceMemoryRetrieval(data: {
  conversationId: string
  appId: string
  queryLength: number
  memoriesFound: number
  topScore: number
  durationMs: number
}): Promise<void> {
  await sendTrace({
    name: 'memory.retrieve',
    type: 'memory',
    ...data,
  })
}

/**
 * Trace a tool execution
 */
export async function traceToolExecution(data: {
  conversationId: string
  appId: string
  toolName: string
  success: boolean
  durationMs: number
  error?: string
  resultSize?: number
}): Promise<void> {
  await sendTrace({
    name: `tool.${data.toolName}`,
    type: 'tool',
    ...data,
  })
}

/**
 * Trace draft creation
 */
export async function traceDraftCreation(data: {
  conversationId: string
  appId: string
  messageId: string
  draftLength: number
  inboxId: string
  channelId?: string
  success: boolean
  durationMs: number
  error?: string
}): Promise<void> {
  await sendTrace({
    name: 'draft.create',
    type: 'draft',
    ...data,
  })
}

/**
 * Trace approval request sent
 */
export async function traceApprovalRequested(data: {
  conversationId: string
  appId: string
  actionId: string
  actionType: string
  customerEmail?: string
}): Promise<void> {
  await sendTrace({
    name: 'approval.requested',
    type: 'approval',
    ...data,
  })
}

/**
 * Trace Slack notification
 */
export async function traceSlackNotification(data: {
  conversationId?: string
  appId?: string
  actionId: string
  success: boolean
  channel?: string
  messageTs?: string
  durationMs: number
  error?: string
}): Promise<void> {
  await sendTrace({
    name: 'slack.notification',
    type: 'slack',
    ...data,
  })
}

/**
 * Trace workflow step (generic step timing)
 */
export async function traceWorkflowStep(data: {
  conversationId?: string
  appId?: string
  workflowName: string
  stepName: string
  durationMs: number
  success: boolean
  error?: string
  metadata?: Record<string, unknown>
}): Promise<void> {
  await sendTrace({
    name: `workflow.step.${data.stepName}`,
    type: 'workflow-step',
    ...data,
  })
}

/**
 * Trace workflow completion
 */
export async function traceWorkflowComplete(data: {
  conversationId: string
  appId: string
  messageId: string
  routingType: string
  totalDurationMs: number
  classificationDurationMs?: number
  agentDurationMs?: number
  memoriesCited: number
  filtered: boolean
  skipped: boolean
  loopDetected: boolean
}): Promise<void> {
  await sendTrace({
    name: 'workflow.complete',
    type: 'workflow',
    ...data,
  })
}

// ============================================================================
// Memory operations tracing
// ============================================================================

/**
 * Trace memory store operation
 */
export async function traceMemoryStore(data: {
  memoryId: string
  collection: string
  appSlug?: string
  source: 'agent' | 'human' | 'system'
  contentLength: number
  tags: string[]
  confidence: number
  durationMs: number
  success: boolean
  error?: string
}): Promise<void> {
  await sendTrace({
    name: 'memory.store',
    type: 'memory-operation',
    operation: 'store',
    ...data,
  })
}

/**
 * Trace memory find operation
 */
export async function traceMemoryFind(data: {
  collection: string
  appSlug?: string
  queryLength: number
  limit: number
  threshold: number
  tags?: string[]
  resultsFound: number
  topScore?: number
  avgScore?: number
  durationMs: number
  success: boolean
  error?: string
}): Promise<void> {
  await sendTrace({
    name: 'memory.find',
    type: 'memory-operation',
    operation: 'find',
    ...data,
  })
}

/**
 * Trace memory vote operation
 */
export async function traceMemoryVote(data: {
  memoryId: string
  collection: string
  voteType: 'upvote' | 'downvote'
  voterId?: string
  previousUpvotes: number
  previousDownvotes: number
  newUpvotes: number
  newDownvotes: number
  durationMs: number
  success: boolean
  error?: string
}): Promise<void> {
  await sendTrace({
    name: 'memory.vote',
    type: 'memory-operation',
    operation: 'vote',
    ...data,
  })
}

/**
 * Trace memory citation operation
 */
export async function traceMemoryCite(data: {
  memoryId: string
  collection: string
  conversationId?: string
  appId?: string
  previousCitations: number
  newCitations: number
  durationMs: number
  success: boolean
  error?: string
}): Promise<void> {
  await sendTrace({
    name: 'memory.cite',
    type: 'memory-operation',
    operation: 'cite',
    ...data,
  })
}

/**
 * Trace memory outcome recording
 */
export async function traceMemoryOutcome(data: {
  memoryId: string
  collection: string
  outcome: 'success' | 'failure'
  conversationId?: string
  appId?: string
  previousSuccessRate: number
  newSuccessRate: number
  totalOutcomes: number
  durationMs: number
  success: boolean
  error?: string
}): Promise<void> {
  await sendTrace({
    name: 'memory.outcome',
    type: 'memory-operation',
    operation: 'outcome',
    ...data,
  })
}
