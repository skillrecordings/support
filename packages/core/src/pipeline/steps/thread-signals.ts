/**
 * Thread Signal Computation
 *
 * Computes thread-level signals from a list of messages.
 * Used by the classifier to understand thread context.
 */

import type {
  MessageAuthorType,
  MessageSignals,
  ThreadClassifyInput,
  ThreadMessage,
  ThreadSignals,
} from '../types'

// ============================================================================
// Resolution patterns
// ============================================================================

const THANK_YOU_PATTERNS = [
  /\bthank(s| you)\b/i,
  /\bappreciate\b/i,
  /\bcheers\b/i,
  /\bperfect\b/i,
  /\bawesome\b/i,
  /\bgreat\b/i,
]

const RESOLUTION_PATTERNS = [
  /\b(that |it |this )?(work(s|ed)|fixed|solved)\b(?!@)/i, // "that worked" not "work@email"
  /\ball (good|set|sorted|done)\b/i,
  /\bgot it(,? thanks)?\b/i,
  /\bmakes sense\b/i,
  /\bno (more |further )?(questions?|issues?|problems?)\b/i,
  /\bsuccessfully\b/i,
  /\bproblem('s| is)? solved\b/i,
  /\bissue('s| is)? (fixed|resolved)\b/i,
  /\bi('m| am) (all )?set\b/i,
  /\bthis (helps|resolved|fixed)\b/i,
  /\bexactly what i needed\b/i,
]

// ============================================================================
// Single-message signal patterns (from v2)
// ============================================================================

const EMAIL_IN_BODY_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/
const PURCHASE_DATE_PATTERN =
  /\b(bought|purchased|ordered|paid)\b.*\b(on|in|at|last|this)\b/i
const ERROR_MESSAGE_PATTERN = /\b(error|exception|failed|crash|bug|broken)\b/i
const INSTRUCTOR_MENTION_PATTERN =
  /\b(matt|pocock|kent|dodds|josh|comeau|instructor|creator|author)\b/i
const ANGRY_SENTIMENT_PATTERN =
  /\b(angry|frustrated|annoyed|furious|terrible|awful|worst|hate|scam|rip.?off|unacceptable|ridiculous)\b/i
const AUTOMATED_PATTERN =
  /\b(auto.?reply|out of office|automatic|do not reply|noreply|mailer.?daemon|undeliverable)\b/i
const VENDOR_OUTREACH_PATTERN =
  /\b(partnership|sponsor(?:ing)?|collaborate|backlink|seo|guest post|link building|promotional|advertise|creator fee|campaign budget|influencer campaign|vp of (?:gtm|growth|partnerships))\b/i

// Legal threat patterns - escalate_urgent ONLY
const LEGAL_THREAT_PATTERN =
  /\b(?:(?:my\s+)?lawyer|legal\s+action|sue\s+(?:you|your)|suing|lawsuit|attorney|court\b.*?(?:action|case|filing)|legal\s+(?:team|counsel)|report(?:ing)?\s+(?:to|this\s+to)\s+(?:the\s+)?(?:ftc|bbb|attorney\s+general))\b/i

// Outside policy timeframe patterns
const OUTSIDE_POLICY_PATTERN =
  /\b(?:(?:6|7|8|9|\d{2,})\s+weeks?\s+ago|(?:45|5\d|6\d|7\d|8\d|9\d|\d{3,})\s+days?\s+ago|(?:2|3|4|5|6|7|8|9|1\d)\s+months?\s+ago|over\s+(?:a\s+)?month\s+ago|more\s+than\s+(?:a\s+)?month)\b/i

// Personal/casual message patterns
const PERSONAL_MESSAGE_PATTERN =
  /\b(?:lol|haha|crazy|wild|insane|big\s+fan|huge\s+fan)\b/i

// ============================================================================
// Signal computation
// ============================================================================

/**
 * Compute single-message signals (same as v2, for backwards compat)
 */
export function computeMessageSignals(
  body: string,
  subject: string = ''
): MessageSignals {
  const text = `${subject} ${body}`

  return {
    hasEmailInBody: EMAIL_IN_BODY_PATTERN.test(body),
    hasPurchaseDate: PURCHASE_DATE_PATTERN.test(text),
    hasErrorMessage: ERROR_MESSAGE_PATTERN.test(text),
    isReply: subject.toLowerCase().startsWith('re:'),
    mentionsInstructor: INSTRUCTOR_MENTION_PATTERN.test(text),
    hasAngrySentiment: ANGRY_SENTIMENT_PATTERN.test(text),
    isAutomated: AUTOMATED_PATTERN.test(text),
    isVendorOutreach: VENDOR_OUTREACH_PATTERN.test(text),
    // Escalation signals
    hasLegalThreat: LEGAL_THREAT_PATTERN.test(text),
    hasOutsidePolicyTimeframe: OUTSIDE_POLICY_PATTERN.test(text),
    isPersonalToInstructor:
      PERSONAL_MESSAGE_PATTERN.test(text) ||
      (INSTRUCTOR_MENTION_PATTERN.test(text) &&
        /(?:thank|love|amazing|big fan)/i.test(text)),
  }
}

/**
 * Compute thread-level signals from a full conversation thread.
 */
export function computeThreadSignals(
  input: ThreadClassifyInput
): ThreadSignals {
  const { messages, triggerMessage, instructorTeammateId } = input

  if (messages.length === 0) {
    throw new Error('Thread must have at least one message')
  }

  // Sort messages by timestamp (should already be sorted, but ensure)
  const sorted = [...messages].sort((a, b) => a.timestamp - b.timestamp)
  const firstMsg = sorted[0]!
  const lastMsg = sorted[sorted.length - 1]!

  // Compute base message signals from trigger message
  const baseSignals = computeMessageSignals(
    triggerMessage.body,
    triggerMessage.subject
  )

  // Also check signals across entire thread
  const allText = sorted.map((m) => `${m.subject || ''} ${m.body}`).join(' ')
  const threadWideSignals = computeMessageSignals(allText)

  // Thread structure
  const threadDurationMs = lastMsg.timestamp - firstMsg.timestamp
  const threadDurationHours = threadDurationMs / (1000 * 60 * 60)

  // Count by author type
  let customerMessageCount = 0
  let teammateMessageCount = 0
  let agentMessageCount = 0
  let hasInstructorMessage = false
  let instructorIsAuthor = false

  for (const msg of sorted) {
    const authorType =
      msg.author?.type || (msg.direction === 'in' ? 'customer' : 'agent')

    switch (authorType) {
      case 'customer':
        customerMessageCount++
        break
      case 'teammate':
        teammateMessageCount++
        break
      case 'instructor':
        teammateMessageCount++ // Instructors count as teammates for counts
        hasInstructorMessage = true
        if (msg === firstMsg) instructorIsAuthor = true
        break
      case 'agent':
        agentMessageCount++
        break
    }

    // Also check by teammate ID (only if both are defined)
    if (
      instructorTeammateId &&
      msg.author?.teammateId &&
      msg.author.teammateId === instructorTeammateId
    ) {
      hasInstructorMessage = true
      if (msg === firstMsg) instructorIsAuthor = true
    }
  }

  // Build thread pattern (e.g., "in-out-in-out")
  const threadPattern = sorted.map((m) => m.direction).join('-')

  // Resolution signals - check customer messages only
  const customerMessages = sorted.filter(
    (m) => m.direction === 'in' && (m.author?.type === 'customer' || !m.author)
  )
  const lastCustomerMsg = customerMessages[customerMessages.length - 1]

  const hasThankYou = lastCustomerMsg
    ? THANK_YOU_PATTERNS.some((p) => p.test(lastCustomerMsg.body))
    : false

  const hasResolutionPhrase = lastCustomerMsg
    ? RESOLUTION_PATTERNS.some((p) => p.test(lastCustomerMsg.body))
    : false

  // Awaiting customer reply: HUMAN teammate sent the last message
  // NOT just any outbound (auto-replies don't count)
  // This means we asked the customer a question and are waiting for their answer
  //
  // Requirements:
  // 1. Last message is outbound
  // 2. A human teammate has participated (not just agent auto-replies)
  // 3. Thread has back-and-forth (customer initiated)
  const hasHumanOutbound = teammateMessageCount > 0
  const awaitingCustomerReply =
    lastMsg.direction === 'out' && hasHumanOutbound && customerMessageCount > 0

  // Teammate signals
  const teammateMessages = sorted.filter(
    (m) => m.author?.type === 'teammate' || m.author?.type === 'instructor'
  )
  const hasTeammateMessage = teammateMessages.length > 0

  // Recent teammate response: did a teammate respond after the last customer message?
  const lastCustomerTimestamp = lastCustomerMsg?.timestamp || 0
  const hasRecentTeammateResponse = teammateMessages.some(
    (m) => m.timestamp > lastCustomerTimestamp
  )

  // Internal thread: no customer messages
  const isInternalThread = customerMessageCount === 0

  // Last responder type
  const lastResponderType: MessageAuthorType =
    lastMsg.author?.type || (lastMsg.direction === 'in' ? 'customer' : 'agent')

  return {
    // Base signals (merged - thread-wide takes precedence for detection)
    hasEmailInBody:
      baseSignals.hasEmailInBody || threadWideSignals.hasEmailInBody,
    hasPurchaseDate:
      baseSignals.hasPurchaseDate || threadWideSignals.hasPurchaseDate,
    hasErrorMessage:
      baseSignals.hasErrorMessage || threadWideSignals.hasErrorMessage,
    isReply: sorted.length > 1 || baseSignals.isReply,
    mentionsInstructor:
      baseSignals.mentionsInstructor || threadWideSignals.mentionsInstructor,
    hasAngrySentiment:
      baseSignals.hasAngrySentiment || threadWideSignals.hasAngrySentiment,
    isAutomated: baseSignals.isAutomated,
    isVendorOutreach: baseSignals.isVendorOutreach && sorted.length === 1, // Only single-message spam
    // Escalation signals (merged - thread-wide takes precedence)
    hasLegalThreat:
      baseSignals.hasLegalThreat || threadWideSignals.hasLegalThreat,
    hasOutsidePolicyTimeframe:
      baseSignals.hasOutsidePolicyTimeframe ||
      threadWideSignals.hasOutsidePolicyTimeframe,
    isPersonalToInstructor:
      baseSignals.isPersonalToInstructor ||
      threadWideSignals.isPersonalToInstructor,

    // Thread structure
    threadLength: sorted.length,
    threadDurationHours,
    customerMessageCount,
    teammateMessageCount,
    agentMessageCount,
    lastMessageDirection: lastMsg.direction,
    threadPattern,

    // Resolution signals
    hasThankYou,
    hasResolutionPhrase,
    awaitingCustomerReply,

    // Teammate/author signals
    hasTeammateMessage,
    hasRecentTeammateResponse,
    hasInstructorMessage,
    instructorIsAuthor,
    isInternalThread,
    lastResponderType,
  }
}

/**
 * Check if thread appears resolved based on signals.
 *
 * Resolution requires:
 * 1. We already responded (there's an outbound message)
 * 2. Customer EXPLICITLY confirms resolution (not just "thanks")
 * 3. The resolution phrase indicates the ISSUE is solved, not just politeness
 *
 * IMPORTANT: A polite "thanks" on a new request is NOT resolution.
 * We need explicit phrases like "that worked", "all set", "got it thanks".
 */
export function isThreadResolved(signals: ThreadSignals): boolean {
  // Must have had a back-and-forth (we responded at some point)
  const weResponded =
    signals.agentMessageCount > 0 || signals.teammateMessageCount > 0
  if (!weResponded) {
    return false
  }

  // Thread must have at least 2 messages (request + response at minimum)
  // Actually, should be at least 3: request -> our response -> their confirmation
  if (signals.threadLength < 2) {
    return false
  }

  // Last message must be from customer (they're confirming resolution)
  if (signals.lastMessageDirection !== 'in') {
    return false
  }

  // STRICT: Require explicit resolution phrase
  // "Thanks" alone is NOT enough - they could be thanking us in advance for a request
  // Resolution phrase indicates the issue was actually handled
  if (signals.hasResolutionPhrase) {
    return true
  }

  return false
}

/**
 * Check if we should support a teammate instead of responding.
 */
export function shouldSupportTeammate(signals: ThreadSignals): boolean {
  // Teammate engaged AND customer replied after AND last message is from customer
  return (
    signals.hasTeammateMessage &&
    signals.lastResponderType === 'customer' &&
    !signals.awaitingCustomerReply
  )
}
