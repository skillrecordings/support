/**
 * Step 2: ROUTE
 *
 * Decides what action to take based on classification.
 * Pure logic - no LLM, no external calls.
 *
 * v3 adds thread-aware routing with support_teammate action.
 */

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

  // Unknown with low confidence - escalate
  {
    name: 'unknown_escalate',
    condition: ({ classification }) =>
      classification.category === 'unknown' || classification.confidence < 0.5,
    action: 'escalate_human',
    reason: 'Cannot confidently classify - needs human review',
  },

  // Fan mail - route to instructor (personal messages explicitly addressed to instructor)
  {
    name: 'fan_mail_instructor',
    condition: ({ classification }) => classification.category === 'fan_mail',
    action: 'escalate_instructor',
    reason: 'Personal message for instructor',
  },

  // Personal/casual messages to instructor (even if not classified as fan_mail)
  {
    name: 'personal_to_instructor',
    condition: ({ classification }) =>
      classification.signals.isPersonalToInstructor,
    action: 'escalate_instructor',
    reason: 'Personal message addressed to instructor',
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

  // Unknown with low confidence - escalate
  {
    name: 'unknown_escalate',
    condition: ({ classification }) =>
      classification.category === 'unknown' || classification.confidence < 0.5,
    action: 'escalate_human',
    reason: 'Cannot confidently classify - needs human review',
  },

  // Fan mail - route to instructor (personal messages)
  {
    name: 'fan_mail_instructor',
    condition: ({ classification }) => classification.category === 'fan_mail',
    action: 'escalate_instructor',
    reason: 'Personal message for instructor',
  },

  // Personal/casual messages to instructor (even if not classified as fan_mail)
  {
    name: 'personal_to_instructor',
    condition: ({ classification }) =>
      classification.signals.isPersonalToInstructor,
    action: 'escalate_instructor',
    reason: 'Personal message addressed to instructor',
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
