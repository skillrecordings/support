import type { RouterCache } from './cache'
import { matchCannedResponse as matchCannedResponseVector } from './canned'
import { classifyMessage } from './classifier'
import { matchRules } from './rules'
import type { RouterDecision, Rule } from './types'

export type { RouterDecision, Rule }
export { matchCannedResponse, interpolateTemplate } from './canned'

/**
 * Canned response definition for pattern-based template matching.
 */
export interface CannedResponse {
  id: string
  pattern: string
  response: string
}

/**
 * Context required for routing decisions.
 */
export interface RoutingContext {
  conversationId: string
  messageId: string
  sender: string
  rules: Rule[]
  cache: RouterCache
  cannedResponses?: CannedResponse[]
  recentMessages?: string[]
}

/**
 * Route incoming message through the decision pipeline.
 *
 * Pipeline order (with early exit):
 * 1. Cache check
 * 2. Rule matching
 * 3. Canned response matching
 * 4. Classifier
 * 5. Agent fallback (if classifier confidence < 0.7)
 *
 * @param message - Incoming message content
 * @param context - Routing context with rules, cache, sender info
 * @returns RouterDecision with route type, confidence, and metadata
 *
 * @example
 * ```typescript
 * const decision = await routeMessage('I want a refund', {
 *   conversationId: 'conv-123',
 *   messageId: 'msg-456',
 *   sender: 'user@example.com',
 *   rules: [{ id: 'refund', priority: 1, type: 'keyword', pattern: 'refund', action: 'escalate' }],
 *   cache: new RouterCache({ decisionTtlMs: 3600000, contextTtlMs: 86400000 })
 * })
 * // => { route: 'rule', ruleId: 'refund', confidence: 1.0, ... }
 * ```
 */
export async function routeMessage(
  message: string,
  context: RoutingContext
): Promise<RouterDecision> {
  const cacheKey = `${context.conversationId}:${context.messageId}`

  // 1. Check cache first
  const cached = context.cache.getDecision(cacheKey)
  if (cached) {
    return cached
  }

  let decision: RouterDecision

  // 2. Check rules
  const ruleMatch = matchRules(message, context.sender, context.rules)
  if (ruleMatch) {
    if (ruleMatch.action === 'route_to_canned' && ruleMatch.cannedResponseId) {
      decision = {
        route: 'canned',
        reason: `Rule ${ruleMatch.ruleId} matched, routing to canned response ${ruleMatch.cannedResponseId}`,
        confidence: 1.0,
        category: 'rule-based',
        ruleId: ruleMatch.ruleId,
        cannedResponseId: ruleMatch.cannedResponseId,
      }
    } else {
      decision = {
        route: 'rule',
        reason: `Matched rule ${ruleMatch.ruleId} with action ${ruleMatch.action}`,
        confidence: 1.0,
        category: 'rule-based',
        ruleId: ruleMatch.ruleId,
      }
    }
    context.cache.setDecision(cacheKey, decision)
    return decision
  }

  // 3. Check canned responses
  if (context.cannedResponses && context.cannedResponses.length > 0) {
    const cannedMatch = matchCannedResponse(message, context.cannedResponses)
    if (cannedMatch) {
      decision = {
        route: 'canned',
        reason: `Matched canned response pattern: ${cannedMatch.pattern}`,
        confidence: 0.9, // High confidence for pattern match, but not rule-level certainty
        category: 'canned',
        cannedResponseId: cannedMatch.id,
      }
      context.cache.setDecision(cacheKey, decision)
      return decision
    }
  }

  // 4. Use classifier
  const classifierResult = await classifyMessage(message, {
    recentMessages: context.recentMessages,
  })

  // 5. Fallback to agent if classifier confidence is low
  if (classifierResult.confidence < 0.7) {
    decision = {
      route: 'agent',
      reason: `Classifier confidence too low (${classifierResult.confidence}): ${classifierResult.reasoning}`,
      confidence: classifierResult.confidence,
      category: classifierResult.category,
    }
  } else {
    decision = {
      route: 'classifier',
      reason: classifierResult.reasoning,
      confidence: classifierResult.confidence,
      category: classifierResult.category,
    }
  }

  context.cache.setDecision(cacheKey, decision)
  return decision
}

/**
 * Match message against canned response patterns.
 * Uses simple case-insensitive keyword matching.
 */
function matchCannedResponse(
  message: string,
  cannedResponses: CannedResponse[]
): CannedResponse | null {
  const lowerMessage = message.toLowerCase()

  for (const canned of cannedResponses) {
    const lowerPattern = canned.pattern.toLowerCase()

    // Support pipe-separated OR patterns like rules
    if (lowerPattern.includes('|')) {
      const keywords = lowerPattern.split('|').map((k) => k.trim())
      if (keywords.some((keyword) => lowerMessage.includes(keyword))) {
        return canned
      }
    } else if (lowerMessage.includes(lowerPattern)) {
      return canned
    }
  }

  return null
}
