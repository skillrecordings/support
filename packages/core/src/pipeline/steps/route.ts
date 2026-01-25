/**
 * Step 2: ROUTE
 *
 * Decides what action to take based on classification.
 * Pure logic - no LLM, no external calls.
 *
 * v3 adds thread-aware routing with support_teammate action.
 * v4 adds memory integration for learning from past routing decisions.
 */

import { SupportMemoryService } from '@skillrecordings/memory/support-memory'
import {
  type RelevantMemory,
  citeMemories,
  formatMemoriesCompact,
  queryMemoriesForStage,
} from '../../memory/query'
import type {
  AppConfig,
  MessageCategory,
  RouteAction,
  RouteInput,
  RouteOutput,
  ThreadClassifyOutput,
  ThreadSignals,
} from '../types'
import { isThreadResolved, shouldSupportTeammate } from './thread-signals'

// ============================================================================
// Routing rules
// ============================================================================

interface RoutingRule {
  name: string
  condition: (input: RouteInput) => boolean
  action: RouteAction
  reason: string
}

const ROUTING_RULES: RoutingRule[] = [
  // System messages - always silent
  {
    name: 'system_silence',
    condition: ({ classification }) => classification.category === 'system',
    action: 'silence',
    reason: 'Automated/system message - no response needed',
  },

  // Spam - always silent
  {
    name: 'spam_silence',
    condition: ({ classification }) => classification.category === 'spam',
    action: 'silence',
    reason: 'Vendor/spam outreach - no response needed',
  },

  // Legal threats - URGENT escalation (lawyer, lawsuit, legal action)
  // This is the ONLY path to escalate_urgent
  {
    name: 'legal_threat_urgent',
    condition: ({ classification }) => classification.signals.hasLegalThreat,
    action: 'escalate_urgent',
    reason: 'Legal threat detected - urgent human review required',
  },

  // Fan mail - route to instructor (personal messages explicitly addressed to instructor)
  // NOTE: Must be BEFORE unknown_escalate so personal messages aren't misrouted
  {
    name: 'fan_mail_instructor',
    condition: ({ classification }) => classification.category === 'fan_mail',
    action: 'escalate_instructor',
    reason: 'Personal message for instructor',
  },

  // Personal/casual messages to instructor (even if not classified as fan_mail)
  // NOTE: Must be BEFORE unknown_escalate so isPersonalToInstructor signal is honored
  {
    name: 'personal_to_instructor',
    condition: ({ classification }) =>
      classification.signals.isPersonalToInstructor,
    action: 'escalate_instructor',
    reason: 'Personal message addressed to instructor',
  },

  // Unknown with low confidence - escalate
  {
    name: 'unknown_escalate',
    condition: ({ classification }) =>
      classification.category === 'unknown' || classification.confidence < 0.5,
    action: 'escalate_human',
    reason: 'Cannot confidently classify - needs human review',
  },

  // Refund outside policy window - needs human approval
  {
    name: 'refund_policy_violation',
    condition: ({ classification }) =>
      classification.category === 'support_refund' &&
      classification.signals.hasOutsidePolicyTimeframe,
    action: 'escalate_human',
    reason: 'Refund request outside policy window - needs human approval',
  },

  // Angry customer - human escalation (NOT urgent - that's for legal only)
  {
    name: 'angry_escalate',
    condition: ({ classification }) => classification.signals.hasAngrySentiment,
    action: 'escalate_human',
    reason: 'Frustrated customer - needs human attention and judgment',
  },

  // Support categories - respond
  {
    name: 'support_respond',
    condition: ({ classification }) =>
      classification.category.startsWith('support_'),
    action: 'respond',
    reason: 'Support request - agent should respond',
  },

  // Presales FAQ - agent can answer from knowledge base
  {
    name: 'presales_faq_respond',
    condition: ({ classification }) =>
      classification.category === 'presales_faq',
    action: 'respond',
    reason: 'Presales FAQ - can answer from knowledge base',
  },

  // Presales team/enterprise - needs sales process
  {
    name: 'presales_team_escalate',
    condition: ({ classification }) =>
      classification.category === 'presales_team',
    action: 'escalate_human',
    reason: 'Team/enterprise inquiry - needs sales process',
  },

  // Presales consult - needs instructor judgment, track for learning
  {
    name: 'presales_consult_escalate',
    condition: ({ classification }) =>
      classification.category === 'presales_consult',
    action: 'escalate_instructor',
    reason:
      'Presales consultation - instructor can provide personalized guidance',
  },
]

// ============================================================================
// Main route function
// ============================================================================

export function route(input: RouteInput): RouteOutput {
  // Apply rules in order (first match wins)
  for (const rule of ROUTING_RULES) {
    if (rule.condition(input)) {
      return {
        action: rule.action,
        reason: rule.reason,
      }
    }
  }

  // Default: escalate if nothing matched
  return {
    action: 'escalate_human',
    reason: 'No routing rule matched - needs human review',
  }
}

// ============================================================================
// Rule customization
// ============================================================================

export interface CustomRoutingRule {
  name: string
  category?: MessageCategory
  signals?: Partial<Record<string, boolean>>
  minConfidence?: number
  maxConfidence?: number
  action: RouteAction
  reason: string
  priority?: number // Lower = higher priority, default 100
}

export function routeWithCustomRules(
  input: RouteInput,
  customRules: CustomRoutingRule[] = []
): RouteOutput {
  // Convert custom rules to standard rules and sort by priority
  const allRules = [
    ...customRules.map((cr) => ({
      name: cr.name,
      condition: (ri: RouteInput) => {
        if (cr.category && ri.classification.category !== cr.category)
          return false
        if (cr.minConfidence && ri.classification.confidence < cr.minConfidence)
          return false
        if (cr.maxConfidence && ri.classification.confidence > cr.maxConfidence)
          return false
        if (cr.signals) {
          for (const [key, value] of Object.entries(cr.signals)) {
            if (
              (ri.classification.signals as unknown as Record<string, boolean>)[
                key
              ] !== value
            )
              return false
          }
        }
        return true
      },
      action: cr.action,
      reason: cr.reason,
      priority: cr.priority ?? 100,
    })),
    ...ROUTING_RULES.map((r, i) => ({ ...r, priority: 200 + i })),
  ].sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100))

  for (const rule of allRules) {
    if (rule.condition(input)) {
      return {
        action: rule.action,
        reason: rule.reason,
      }
    }
  }

  return {
    action: 'escalate_human',
    reason: 'No routing rule matched',
  }
}

// ============================================================================
// Helpers for testing
// ============================================================================

export function shouldRespond(action: RouteAction): boolean {
  return action === 'respond'
}

export function shouldEscalate(action: RouteAction): boolean {
  return action.startsWith('escalate_')
}

export function shouldSilence(action: RouteAction): boolean {
  return action === 'silence'
}

export function getRoutingRules(): RoutingRule[] {
  return [...ROUTING_RULES]
}

// ============================================================================
// Thread-aware routing (v3)
// ============================================================================

export interface ThreadRouteInput {
  classification: ThreadClassifyOutput
  appConfig: AppConfig
}

interface ThreadRoutingRule {
  name: string
  condition: (input: ThreadRouteInput) => boolean
  action: RouteAction
  reason: string
}

const THREAD_ROUTING_RULES: ThreadRoutingRule[] = [
  // Resolved threads - silence
  {
    name: 'resolved_silence',
    condition: ({ classification }) =>
      classification.category === 'resolved' ||
      isThreadResolved(classification.signals),
    action: 'silence',
    reason: 'Thread already resolved - no response needed',
  },

  // Awaiting customer reply - silence
  {
    name: 'awaiting_customer_silence',
    condition: ({ classification }) =>
      classification.category === 'awaiting_customer' ||
      classification.signals.awaitingCustomerReply,
    action: 'silence',
    reason: 'Awaiting customer reply - no response needed yet',
  },

  // Teammate already engaged - support them
  {
    name: 'support_teammate',
    condition: ({ classification }) =>
      shouldSupportTeammate(classification.signals),
    action: 'support_teammate',
    reason: 'Human teammate is handling - adding context as comment',
  },

  // Instructor strategy - route to instructor
  {
    name: 'instructor_strategy',
    condition: ({ classification }) =>
      classification.category === 'instructor_strategy' ||
      classification.signals.instructorIsAuthor,
    action: 'escalate_instructor',
    reason: 'Instructor strategy discussion',
  },

  // Internal thread (no customers) - silence or escalate
  {
    name: 'internal_thread',
    condition: ({ classification }) => classification.signals.isInternalThread,
    action: 'silence',
    reason: 'Internal thread - no customer to respond to',
  },

  // System messages - always silent
  {
    name: 'system_silence',
    condition: ({ classification }) => classification.category === 'system',
    action: 'silence',
    reason: 'Automated/system message - no response needed',
  },

  // Spam - always silent (single-message vendor outreach)
  {
    name: 'spam_silence',
    condition: ({ classification }) => classification.category === 'spam',
    action: 'silence',
    reason: 'Vendor/spam outreach - no response needed',
  },

  // Legal threats - URGENT escalation (lawyer, lawsuit, legal action)
  // This is the ONLY path to escalate_urgent
  {
    name: 'legal_threat_urgent',
    condition: ({ classification }) => classification.signals.hasLegalThreat,
    action: 'escalate_urgent',
    reason: 'Legal threat detected - urgent human review required',
  },

  // VOC responses - catalog and analyze (valuable customer data)
  {
    name: 'voc_response_catalog',
    condition: ({ classification }) =>
      classification.category === 'voc_response',
    action: 'catalog_voc',
    reason:
      'Voice of customer response - catalog, tag, notify Slack, maybe request testimonial expansion',
  },

  // Fan mail - route to instructor (personal messages)
  // NOTE: Must be BEFORE unknown_escalate so personal messages aren't misrouted
  {
    name: 'fan_mail_instructor',
    condition: ({ classification }) => classification.category === 'fan_mail',
    action: 'escalate_instructor',
    reason: 'Personal message for instructor',
  },

  // Personal/casual messages to instructor (even if not classified as fan_mail)
  // NOTE: Must be BEFORE unknown_escalate so isPersonalToInstructor signal is honored
  {
    name: 'personal_to_instructor',
    condition: ({ classification }) =>
      classification.signals.isPersonalToInstructor,
    action: 'escalate_instructor',
    reason: 'Personal message addressed to instructor',
  },

  // Unknown with low confidence - escalate
  {
    name: 'unknown_escalate',
    condition: ({ classification }) =>
      classification.category === 'unknown' || classification.confidence < 0.5,
    action: 'escalate_human',
    reason: 'Cannot confidently classify - needs human review',
  },

  // Refund outside policy window - needs human approval
  {
    name: 'refund_policy_violation',
    condition: ({ classification }) =>
      classification.category === 'support_refund' &&
      classification.signals.hasOutsidePolicyTimeframe,
    action: 'escalate_human',
    reason: 'Refund request outside policy window - needs human approval',
  },

  // Angry customer - human escalation (NOT urgent - that's for legal only)
  {
    name: 'angry_escalate',
    condition: ({ classification }) => classification.signals.hasAngrySentiment,
    action: 'escalate_human',
    reason: 'Frustrated customer - needs human attention and judgment',
  },

  // Support categories - respond
  {
    name: 'support_respond',
    condition: ({ classification }) =>
      classification.category.startsWith('support_'),
    action: 'respond',
    reason: 'Support request - agent should respond',
  },

  // Presales FAQ - agent can answer from knowledge base
  {
    name: 'presales_faq_respond',
    condition: ({ classification }) =>
      classification.category === 'presales_faq',
    action: 'respond',
    reason: 'Presales FAQ - can answer from knowledge base',
  },

  // Presales team/enterprise - needs sales process
  {
    name: 'presales_team_escalate',
    condition: ({ classification }) =>
      classification.category === 'presales_team',
    action: 'escalate_human',
    reason: 'Team/enterprise inquiry - needs sales process',
  },

  // Presales consult - needs instructor judgment, track for learning
  {
    name: 'presales_consult_escalate',
    condition: ({ classification }) =>
      classification.category === 'presales_consult',
    action: 'escalate_instructor',
    reason:
      'Presales consultation - instructor can provide personalized guidance',
  },
]

/**
 * Route a thread-based classification to an action.
 * Includes thread-aware rules (resolved, awaiting, support_teammate).
 */
export function routeThread(input: ThreadRouteInput): RouteOutput {
  for (const rule of THREAD_ROUTING_RULES) {
    if (rule.condition(input)) {
      return {
        action: rule.action,
        reason: rule.reason,
      }
    }
  }

  return {
    action: 'escalate_human',
    reason: 'No routing rule matched - needs human review',
  }
}

/**
 * Get all thread routing rules (for testing/inspection).
 */
export function getThreadRoutingRules(): ThreadRoutingRule[] {
  return [...THREAD_ROUTING_RULES]
}

// ============================================================================
// Memory-aware routing (v4)
// ============================================================================

export interface RouteWithMemoryInput extends RouteInput {
  conversationId?: string
  runId?: string
}

export interface ThreadRouteWithMemoryInput extends ThreadRouteInput {
  conversationId: string
  runId?: string
}

export interface RouteWithMemoryOutput extends RouteOutput {
  /** Memories that influenced this routing decision */
  citedMemoryIds?: string[]
  /** Memory context that was considered */
  memoryContext?: string
  /** Whether memory suggested a different route */
  memoryOverride?: {
    suggestedAction: RouteAction
    reason: string
    confidence: number
  }
}

/**
 * Route with memory integration.
 *
 * Queries past routing decisions to learn from similar situations:
 * - If similar tickets were escalated and confirmed correct, may suggest escalation
 * - If similar escalations were corrected ("should have responded"), avoids over-escalating
 *
 * @example
 * ```typescript
 * const result = await routeWithMemory({
 *   message,
 *   classification,
 *   appConfig,
 *   conversationId: 'cnv_abc123',
 *   runId: 'run_xyz'
 * })
 *
 * // Check if memory suggested a different route
 * if (result.memoryOverride) {
 *   console.log('Memory suggests:', result.memoryOverride.suggestedAction)
 * }
 * ```
 */
export async function routeWithMemory(
  input: RouteWithMemoryInput
): Promise<RouteWithMemoryOutput> {
  const { message, classification, appConfig, conversationId, runId } = input

  // Get base rule-based routing first
  const baseResult = route({ message, classification, appConfig })

  // Query memory for similar routing decisions
  let memories: RelevantMemory[] = []
  let memoryContext = ''
  let memoryOverride: RouteWithMemoryOutput['memoryOverride'] = undefined

  try {
    const situation = buildRoutingSituation(classification, message)

    memories = await queryMemoriesForStage({
      appId: appConfig.appId,
      stage: 'route',
      situation,
      category: classification.category,
      limit: 5,
      threshold: 0.6,
    })

    if (memories.length > 0) {
      memoryContext = formatMemoriesCompact(memories)

      // Analyze memories for routing guidance
      memoryOverride = analyzeMemoriesForRouting(memories, baseResult.action)

      // Record citation if we have a run ID
      if (runId) {
        const citedIds = memories.map((m) => m.id)
        await citeMemories(citedIds, runId, appConfig.appId)
      }
    }
  } catch (error) {
    // Log but don't fail routing if memory query fails
    console.warn('[route] Memory query failed:', error)
  }

  // If memory strongly suggests a different action, include the recommendation
  // but don't override automatically - let the caller decide
  return {
    action: baseResult.action,
    reason: memoryOverride
      ? `${baseResult.reason} [Memory suggests: ${memoryOverride.suggestedAction} - ${memoryOverride.reason}]`
      : baseResult.reason,
    citedMemoryIds: memories.length > 0 ? memories.map((m) => m.id) : undefined,
    memoryContext: memoryContext || undefined,
    memoryOverride,
  }
}

/**
 * Thread-aware routing with memory integration.
 *
 * @example
 * ```typescript
 * const result = await routeThreadWithMemory({
 *   classification,
 *   appConfig,
 *   conversationId: 'cnv_abc123',
 *   runId: 'run_xyz'
 * })
 * ```
 */
export async function routeThreadWithMemory(
  input: ThreadRouteWithMemoryInput
): Promise<RouteWithMemoryOutput> {
  const { classification, appConfig, conversationId, runId } = input

  // Get base rule-based routing first
  const baseResult = routeThread({ classification, appConfig })

  // Query memory for similar routing decisions
  let memories: RelevantMemory[] = []
  let memoryContext = ''
  let memoryOverride: RouteWithMemoryOutput['memoryOverride'] = undefined

  try {
    const situation = buildThreadRoutingSituation(classification)

    memories = await queryMemoriesForStage({
      appId: appConfig.appId,
      stage: 'route',
      situation,
      category: classification.category,
      limit: 5,
      threshold: 0.6,
    })

    if (memories.length > 0) {
      memoryContext = formatMemoriesCompact(memories)

      // Analyze memories for routing guidance
      memoryOverride = analyzeMemoriesForRouting(memories, baseResult.action)

      // Record citation if we have a run ID
      if (runId) {
        const citedIds = memories.map((m) => m.id)
        await citeMemories(citedIds, runId, appConfig.appId)
      }
    }
  } catch (error) {
    // Log but don't fail routing if memory query fails
    console.warn('[routeThread] Memory query failed:', error)
  }

  return {
    action: baseResult.action,
    reason: memoryOverride
      ? `${baseResult.reason} [Memory suggests: ${memoryOverride.suggestedAction} - ${memoryOverride.reason}]`
      : baseResult.reason,
    citedMemoryIds: memories.length > 0 ? memories.map((m) => m.id) : undefined,
    memoryContext: memoryContext || undefined,
    memoryOverride,
  }
}

// ============================================================================
// Memory Analysis Helpers
// ============================================================================

/**
 * Build situation string for routing memory query.
 */
function buildRoutingSituation(
  classification: RouteInput['classification'],
  message: RouteInput['message']
): string {
  const parts = [
    `Category: ${classification.category}`,
    `Confidence: ${(classification.confidence * 100).toFixed(0)}%`,
  ]

  // Add relevant signals
  const signals = classification.signals
  if (signals.hasAngrySentiment) parts.push('Sentiment: Angry')
  if (signals.hasLegalThreat) parts.push('Signal: Legal threat')
  if (signals.hasOutsidePolicyTimeframe)
    parts.push('Signal: Outside policy window')
  if (signals.isPersonalToInstructor)
    parts.push('Signal: Personal to instructor')

  // Add subject/body summary
  parts.push(`\nIssue: ${message.subject}`)
  if (message.body.length > 200) {
    parts.push(message.body.slice(0, 200) + '...')
  } else {
    parts.push(message.body)
  }

  return parts.join('\n')
}

/**
 * Build situation string for thread-based routing memory query.
 */
function buildThreadRoutingSituation(
  classification: ThreadClassifyOutput
): string {
  const parts = [
    `Category: ${classification.category}`,
    `Confidence: ${(classification.confidence * 100).toFixed(0)}%`,
  ]

  // Add thread signals
  const signals = classification.signals
  parts.push(`Thread length: ${signals.threadLength} messages`)
  if (signals.hasAngrySentiment) parts.push('Sentiment: Angry')
  if (signals.hasLegalThreat) parts.push('Signal: Legal threat')
  if (signals.hasTeammateMessage) parts.push('Signal: Teammate engaged')
  if (signals.hasInstructorMessage) parts.push('Signal: Instructor involved')

  // Add reasoning if available
  if (classification.reasoning) {
    parts.push(`\nContext: ${classification.reasoning}`)
  }

  return parts.join('\n')
}

/**
 * Analyze memories to determine if they suggest a different route.
 *
 * Logic:
 * - If similar situations were escalated and marked SUCCESS -> suggest escalating
 * - If similar situations were auto-responded and marked SUCCESS -> suggest responding
 * - If there are CORRECTED memories saying "should have escalated" -> suggest escalating
 * - If there are CORRECTED memories saying "should have responded" -> suggest responding
 */
function analyzeMemoriesForRouting(
  memories: RelevantMemory[],
  currentAction: RouteAction
): RouteWithMemoryOutput['memoryOverride'] {
  // Count outcomes by action suggested in memories
  const actionCounts: Record<
    string,
    { success: number; corrected: number; total: number }
  > = {}

  for (const memory of memories) {
    // Parse the decision to extract the route action
    const actionMatch = memory.decision.match(/Routed to:\s*(\w+)/i)
    const routedAction = actionMatch?.[1] || 'unknown'

    if (!actionCounts[routedAction]) {
      actionCounts[routedAction] = { success: 0, corrected: 0, total: 0 }
    }
    actionCounts[routedAction].total++

    if (memory.outcome === 'success') {
      actionCounts[routedAction].success++
    } else if (memory.outcome === 'corrected' && memory.correction) {
      actionCounts[routedAction].corrected++

      // Parse what the correction suggested
      const correctionMatch = memory.correction.match(/Should have:\s*(\w+)/i)
      const suggestedAction = correctionMatch?.[1]
      if (suggestedAction && suggestedAction !== routedAction) {
        if (!actionCounts[suggestedAction]) {
          actionCounts[suggestedAction] = { success: 0, corrected: 0, total: 0 }
        }
        // Count corrections as evidence FOR the suggested action
        actionCounts[suggestedAction].success++
      }
    }
  }

  // Determine if there's strong evidence for a different action
  let bestAction: string | null = null
  let bestScore = 0

  for (const [action, counts] of Object.entries(actionCounts)) {
    // Score = successes - (corrected * 2), weighted by recency (already in score)
    const score = counts.success - counts.corrected * 2
    if (score > bestScore && score >= 2) {
      // Need at least 2 positive signals
      bestAction = action
      bestScore = score
    }
  }

  // Only suggest override if best action differs from current
  if (
    bestAction &&
    bestAction !== currentAction &&
    isValidRouteAction(bestAction)
  ) {
    const counts = actionCounts[bestAction]
    const confidence = Math.min(0.9, 0.5 + bestScore * 0.1)

    return {
      suggestedAction: bestAction as RouteAction,
      reason: `${counts?.success ?? 0} similar tickets routed this way successfully`,
      confidence,
    }
  }

  // Check for corrections suggesting we should escalate when we're about to respond
  if (currentAction === 'respond') {
    for (const memory of memories) {
      if (
        memory.outcome === 'corrected' &&
        memory.correction &&
        memory.correction.includes('escalate') &&
        memory.score > 0.7 // High similarity
      ) {
        return {
          suggestedAction: 'escalate_human',
          reason: `Similar ticket was corrected: ${memory.correction}`,
          confidence: 0.7,
        }
      }
    }
  }

  return undefined
}

/**
 * Type guard for valid route actions.
 */
function isValidRouteAction(action: string): action is RouteAction {
  const validActions: RouteAction[] = [
    'respond',
    'silence',
    'escalate_human',
    'escalate_instructor',
    'escalate_urgent',
    'support_teammate',
    'catalog_voc',
  ]
  return validActions.includes(action as RouteAction)
}

// ============================================================================
// Routing Outcome Recording
// ============================================================================

export interface RecordRoutingOutcomeInput {
  /** App identifier */
  appId: string
  /** Category of the ticket */
  category: MessageCategory
  /** Summary of the issue */
  issueSummary: string
  /** What action was taken */
  routedAction: RouteAction
  /** Was the routing correct? */
  wasCorrect: boolean
  /** If incorrect, what should have been done */
  correctAction?: RouteAction
  /** Conversation ID for tracking */
  conversationId: string
  /** Optional: Additional context about why the correction was needed */
  correctionReason?: string
  /** Optional: Memory IDs that influenced the original routing */
  citedMemoryIds?: string[]
  /** Optional: Run ID for citation tracking */
  runId?: string
}

/**
 * Record a routing outcome to memory.
 *
 * Call this when a human confirms or corrects a routing decision.
 * This enables the system to learn from routing mistakes.
 *
 * @example
 * ```typescript
 * // Routing was correct
 * await recordRoutingOutcome({
 *   appId: 'total-typescript',
 *   category: 'support_refund',
 *   issueSummary: 'Customer requested refund after 2 months',
 *   routedAction: 'escalate_human',
 *   wasCorrect: true,
 *   conversationId: 'cnv_abc123'
 * })
 *
 * // Routing was incorrect - should have escalated
 * await recordRoutingOutcome({
 *   appId: 'total-typescript',
 *   category: 'support_technical',
 *   issueSummary: 'Complex technical question about edge case',
 *   routedAction: 'respond',
 *   wasCorrect: false,
 *   correctAction: 'escalate_instructor',
 *   correctionReason: 'Question required instructor expertise',
 *   conversationId: 'cnv_def456'
 * })
 * ```
 */
export async function recordRoutingOutcome(
  input: RecordRoutingOutcomeInput
): Promise<void> {
  const {
    appId,
    category,
    issueSummary,
    routedAction,
    wasCorrect,
    correctAction,
    conversationId,
    correctionReason,
    citedMemoryIds,
    runId,
  } = input

  const situation = `Category: ${category}\nIssue: ${issueSummary}`
  const decision = `Routed to: ${routedAction}`

  const tags = ['routing', category, routedAction]
  if (!wasCorrect && correctAction) {
    tags.push('misroute', correctAction)
  }

  // Store the routing decision as a memory
  await SupportMemoryService.store({
    app_slug: appId,
    situation,
    decision,
    stage: 'route',
    outcome: wasCorrect ? 'success' : 'corrected',
    correction: wasCorrect
      ? undefined
      : `Should have: ${correctAction}${correctionReason ? ` - ${correctionReason}` : ''}`,
    category,
    conversation_id: conversationId,
    tags,
  })

  // If we know which memories were cited in the routing decision,
  // record the outcome for those memories
  if (runId && citedMemoryIds && citedMemoryIds.length > 0) {
    try {
      await SupportMemoryService.recordCitationOutcome(
        citedMemoryIds,
        runId,
        wasCorrect ? 'success' : 'failure',
        appId
      )
    } catch (error) {
      console.warn(
        '[recordRoutingOutcome] Failed to record citation outcome:',
        error
      )
    }
  }
}

/**
 * Record that routing to escalation was confirmed correct.
 * Convenience wrapper for common case.
 */
export async function recordEscalationConfirmed(
  appId: string,
  category: MessageCategory,
  issueSummary: string,
  escalationType: 'escalate_human' | 'escalate_instructor' | 'escalate_urgent',
  conversationId: string
): Promise<void> {
  await recordRoutingOutcome({
    appId,
    category,
    issueSummary,
    routedAction: escalationType,
    wasCorrect: true,
    conversationId,
  })
}

/**
 * Record that a response should have been escalated instead.
 * Common case: agent responded but human had to intervene.
 */
export async function recordShouldHaveEscalated(
  appId: string,
  category: MessageCategory,
  issueSummary: string,
  correctEscalationType:
    | 'escalate_human'
    | 'escalate_instructor'
    | 'escalate_urgent',
  conversationId: string,
  reason?: string
): Promise<void> {
  await recordRoutingOutcome({
    appId,
    category,
    issueSummary,
    routedAction: 'respond',
    wasCorrect: false,
    correctAction: correctEscalationType,
    correctionReason: reason,
    conversationId,
  })
}

/**
 * Record that an escalation was unnecessary - should have auto-responded.
 * Common case: escalated but could have been handled automatically.
 */
export async function recordUnnecessaryEscalation(
  appId: string,
  category: MessageCategory,
  issueSummary: string,
  escalationType: 'escalate_human' | 'escalate_instructor' | 'escalate_urgent',
  conversationId: string,
  reason?: string
): Promise<void> {
  await recordRoutingOutcome({
    appId,
    category,
    issueSummary,
    routedAction: escalationType,
    wasCorrect: false,
    correctAction: 'respond',
    correctionReason: reason,
    conversationId,
  })
}
