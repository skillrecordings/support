/**
 * Step 5b: COMMENT
 *
 * Adds a support comment to a conversation when a teammate is handling.
 * Used for the support_teammate action - provides research context without
 * drafting a customer-facing response.
 *
 * Also includes formatters for:
 * - Escalation comments (full context for human handoff)
 * - Approval comments (draft review with confidence)
 * - Audit comments (lightweight action trail)
 */

import { createFrontClient } from '@skillrecordings/front-sdk'
import type { CommentInput, CommentOutput, GatherOutput } from '../types'

// ============================================================================
// Escalation & Handoff Types
// ============================================================================

export type EscalationType =
  | 'urgent'
  | 'normal'
  | 'instructor'
  | 'teammate_support'
  | 'voc'

export interface CustomerInfo {
  email: string
  name?: string
  id?: string
}

export interface PurchaseInfo {
  productName: string
  productId?: string
  purchasedAt: string
  status: string
  amount?: number
}

export interface EscalationLinks {
  /** Admin profile URL */
  admin?: string
  /** Magic login link */
  magicLogin?: string
  /** Front conversation link */
  frontConversation?: string
}

export interface EscalationContext {
  /** Escalation priority/type */
  type: EscalationType
  /** Why this was escalated */
  reason: string
  /** Customer information */
  customer: CustomerInfo
  /** Customer purchases */
  purchases?: PurchaseInfo[]
  /** Classification details */
  classification?: {
    category: string
    confidence: number
    reasoning?: string
  }
  /** What the agent found/tried */
  agentFindings?: string[]
  /** Quick links for the human agent */
  links?: EscalationLinks
}

export interface ApprovalContext {
  /** Draft being reviewed */
  draft: string
  /** Why it needs review */
  reviewReason: string
  /** Agent confidence score (0-1) */
  confidence: number
  /** Classification category */
  category?: string
  /** Customer email for context */
  customerEmail?: string
  /** Optional action links (approve/edit) */
  actionLinks?: {
    approve?: string
    edit?: string
  }
}

export interface AuditContext {
  /** Action that was taken */
  action: 'auto_sent' | 'draft_created' | 'silenced' | 'escalated' | string
  /** Category of the message */
  category: string
  /** Confidence score (0-1) */
  confidence: number
  /** Timestamp of the action */
  timestamp?: Date
  /** Optional message ID for reference */
  messageId?: string
}

// ============================================================================
// Comment formatting
// ============================================================================

/**
 * Format gathered context into a useful support comment.
 */
export function formatSupportComment(context: GatherOutput): string {
  const parts: string[] = ['🤖 **Agent Research Context**\n']

  // Customer info
  if (context.user) {
    parts.push(`**Customer:** ${context.user.email}`)
    if (context.user.name) {
      parts.push(`**Name:** ${context.user.name}`)
    }
  }

  // Purchases
  if (context.purchases.length > 0) {
    parts.push('\n**Purchases:**')
    for (const p of context.purchases) {
      const status = p.status !== 'active' ? ` (${p.status})` : ''
      const amount = p.amount ? ` - $${(p.amount / 100).toFixed(2)}` : ''
      parts.push(`- ${p.productName}${amount}${status}`)
    }
  } else if (context.user) {
    parts.push('\n**Purchases:** None found for this email')
  }

  // Knowledge base hits
  if (context.knowledge.length > 0) {
    parts.push('\n**Relevant KB:**')
    for (const k of context.knowledge.slice(0, 3)) {
      const source = k.source ? ` [${k.source}]` : ''
      parts.push(`- ${k.content.slice(0, 100)}...${source}`)
    }
  }

  // Similar resolved tickets
  const similarTickets = context.knowledge.filter(
    (k) => k.type === 'similar_ticket'
  )
  if (similarTickets.length > 0) {
    parts.push('\n**Similar tickets:**')
    for (const t of similarTickets.slice(0, 2)) {
      parts.push(`- ${t.content.slice(0, 150)}...`)
    }
  }

  // Prior memory
  if (context.priorMemory.length > 0) {
    parts.push('\n**Agent memory:**')
    for (const m of context.priorMemory.slice(0, 2)) {
      parts.push(`- ${m.content.slice(0, 100)}...`)
    }
  }

  // Gather errors (internal note)
  if (context.gatherErrors.length > 0) {
    parts.push('\n⚠️ _Some data unavailable:_')
    for (const e of context.gatherErrors) {
      parts.push(`- ${e.step}: ${e.error}`)
    }
  }

  return parts.join('\n')
}

/**
 * Format a minimal comment when we have limited context.
 */
export function formatMinimalComment(context: GatherOutput): string {
  const parts: string[] = ['🤖 **Agent Context**\n']

  if (context.user) {
    parts.push(`Customer: ${context.user.email}`)
    parts.push(
      `Purchases: ${context.purchases.length > 0 ? context.purchases.map((p) => p.productName).join(', ') : 'None found'}`
    )
  } else {
    parts.push('_Could not look up customer info_')
  }

  return parts.join('\n')
}

// ============================================================================
// Escalation & Handoff Formatters
// ============================================================================

/**
 * Get emoji for escalation type.
 */
function getEscalationEmoji(type: EscalationType): string {
  switch (type) {
    case 'urgent':
      return '🚨'
    case 'instructor':
      return '👨‍🏫'
    case 'teammate_support':
      return '🤝'
    case 'voc':
      return '📣'
    default:
      return '⚠️'
  }
}

/**
 * Format escalation type for display.
 */
function formatEscalationType(type: EscalationType): string {
  switch (type) {
    case 'urgent':
      return 'URGENT'
    case 'instructor':
      return 'Instructor'
    case 'teammate_support':
      return 'Teammate Support'
    case 'voc':
      return 'Voice of Customer'
    default:
      return 'Escalated'
  }
}

/**
 * Format a purchase for display with optional admin link.
 */
function formatPurchase(purchase: PurchaseInfo, adminBaseUrl?: string): string {
  const status = purchase.status !== 'active' ? ` (${purchase.status})` : ''
  const amount = purchase.amount
    ? ` - $${(purchase.amount / 100).toFixed(2)}`
    : ''

  // Add admin link if available
  if (adminBaseUrl && purchase.productId) {
    const adminLink = `${adminBaseUrl}/purchases/${purchase.productId}`
    return `- [${purchase.productName}](${adminLink})${amount}${status}`
  }

  return `- ${purchase.productName}${amount}${status}`
}

/**
 * Format an escalation comment for Front conversation.
 * Provides full context for human agents handling escalations.
 *
 * @example
 * ```ts
 * const comment = formatEscalationComment({
 *   type: 'urgent',
 *   reason: 'Legal threat detected',
 *   customer: { email: 'user@example.com', name: 'John Doe' },
 *   purchases: [{ productName: 'Course', purchasedAt: '2024-01-01', status: 'active' }],
 *   links: { admin: 'https://admin.example.com/users/123', magicLogin: 'https://...' }
 * })
 * ```
 */
export function formatEscalationComment(context: EscalationContext): string {
  const parts: string[] = []

  // Header with type + emoji
  const emoji = getEscalationEmoji(context.type)
  const typeLabel = formatEscalationType(context.type)
  parts.push(`${emoji} **Agent Escalation (${typeLabel})**\n`)

  // Escalation reason
  parts.push(`**Reason:** ${context.reason}`)

  // Classification details if available
  if (context.classification) {
    parts.push(`**Category:** ${context.classification.category}`)
    parts.push(
      `**Confidence:** ${Math.round(context.classification.confidence * 100)}%`
    )
    if (context.classification.reasoning) {
      parts.push(`**Agent reasoning:** ${context.classification.reasoning}`)
    }
  }

  // Customer info section
  parts.push('\n---')
  parts.push('**Customer Info**')
  parts.push(`- **Email:** ${context.customer.email}`)
  if (context.customer.name) {
    parts.push(`- **Name:** ${context.customer.name}`)
  }
  if (context.customer.id) {
    parts.push(`- **ID:** ${context.customer.id}`)
  }

  // Purchases section
  parts.push('\n**Purchases:**')
  if (context.purchases && context.purchases.length > 0) {
    const adminBaseUrl = context.links?.admin?.replace(/\/users\/.*$/, '')
    for (const p of context.purchases) {
      parts.push(formatPurchase(p, adminBaseUrl))
    }
  } else {
    parts.push('_No purchases found for this email_')
  }

  // Agent findings (what was tried/found)
  if (context.agentFindings && context.agentFindings.length > 0) {
    parts.push('\n**What Agent Found/Tried:**')
    for (const finding of context.agentFindings) {
      parts.push(`- ${finding}`)
    }
  }

  // Quick links section
  if (context.links) {
    const hasLinks =
      context.links.admin ||
      context.links.magicLogin ||
      context.links.frontConversation
    if (hasLinks) {
      parts.push('\n---')
      parts.push('**Quick Links**')
      if (context.links.admin) {
        parts.push(`- [Admin Profile](${context.links.admin})`)
      }
      if (context.links.magicLogin) {
        parts.push(`- [Magic Login](${context.links.magicLogin})`)
      }
      if (context.links.frontConversation) {
        parts.push(`- [Front Conversation](${context.links.frontConversation})`)
      }
    }
  }

  return parts.join('\n')
}

/**
 * Format an approval comment for draft review.
 * Shows the draft preview with confidence and review context.
 *
 * @example
 * ```ts
 * const comment = formatApprovalComment({
 *   draft: 'Hi! Here is your magic link...',
 *   reviewReason: 'Low confidence response',
 *   confidence: 0.65,
 *   category: 'support_access',
 *   customerEmail: 'user@example.com'
 * })
 * ```
 */
export function formatApprovalComment(context: ApprovalContext): string {
  const parts: string[] = []

  // Header
  parts.push('🔍 **Draft Pending Review**\n')

  // Why it needs review
  parts.push(`**Review Reason:** ${context.reviewReason}`)

  // Confidence with visual indicator
  const confidencePercent = Math.round(context.confidence * 100)
  const confidenceEmoji =
    confidencePercent >= 80 ? '🟢' : confidencePercent >= 60 ? '🟡' : '🔴'
  parts.push(`**Confidence:** ${confidenceEmoji} ${confidencePercent}%`)

  // Category if available
  if (context.category) {
    parts.push(`**Category:** ${context.category}`)
  }

  // Customer email for quick context
  if (context.customerEmail) {
    parts.push(`**Customer:** ${context.customerEmail}`)
  }

  // Draft preview
  parts.push('\n---')
  parts.push('**Draft Preview:**')
  parts.push('')
  // Indent the draft for visual separation
  const draftLines = context.draft.split('\n')
  for (const line of draftLines) {
    parts.push(`> ${line}`)
  }

  // Action links if available
  if (context.actionLinks) {
    parts.push('\n---')
    parts.push('**Actions:**')
    if (context.actionLinks.approve) {
      parts.push(`- [✅ Approve & Send](${context.actionLinks.approve})`)
    }
    if (context.actionLinks.edit) {
      parts.push(`- [✏️ Edit Draft](${context.actionLinks.edit})`)
    }
  }

  return parts.join('\n')
}

/**
 * Format a lightweight audit comment for action tracking.
 * Records what action was taken for the audit trail.
 *
 * @example
 * ```ts
 * const comment = formatAuditComment({
 *   action: 'auto_sent',
 *   category: 'support_access',
 *   confidence: 0.92,
 *   timestamp: new Date()
 * })
 * ```
 */
export function formatAuditComment(context: AuditContext): string {
  const parts: string[] = []

  // Determine emoji based on action
  const actionEmoji =
    context.action === 'auto_sent'
      ? '✅'
      : context.action === 'draft_created'
        ? '📝'
        : context.action === 'silenced'
          ? '🔇'
          : context.action === 'escalated'
            ? '⚠️'
            : '🤖'

  // Compact header
  parts.push(
    `${actionEmoji} **Agent Action: ${formatActionLabel(context.action)}**`
  )

  // Category and confidence on same line
  const confidencePercent = Math.round(context.confidence * 100)
  parts.push(
    `Category: ${context.category} | Confidence: ${confidencePercent}%`
  )

  // Timestamp
  const timestamp = context.timestamp ?? new Date()
  parts.push(`Timestamp: ${timestamp.toISOString()}`)

  // Message ID if available
  if (context.messageId) {
    parts.push(`Message ID: ${context.messageId}`)
  }

  return parts.join('\n')
}

/**
 * Format action type for display.
 */
function formatActionLabel(action: string): string {
  switch (action) {
    case 'auto_sent':
      return 'Auto-sent'
    case 'draft_created':
      return 'Draft Created'
    case 'silenced':
      return 'Silenced'
    case 'escalated':
      return 'Escalated'
    default:
      return action.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  }
}

// ============================================================================
// Comment step
// ============================================================================

export interface AddCommentOptions {
  /** Front API token */
  frontApiToken: string
  /** Teammate ID to attribute the comment to (optional) */
  authorId?: string
  /** Use minimal format instead of full context */
  minimal?: boolean
}

/**
 * Add a support comment to a Front conversation.
 *
 * @param input - Conversation ID and gathered context
 * @param options - Front API token and formatting options
 * @returns Result with success status
 */
export async function addSupportComment(
  input: CommentInput,
  options: AddCommentOptions
): Promise<CommentOutput> {
  const { conversationId, context } = input
  const { frontApiToken, authorId, minimal } = options

  try {
    const front = createFrontClient({ apiToken: frontApiToken })

    // Format the comment
    const body = minimal
      ? formatMinimalComment(context)
      : formatSupportComment(context)

    // Add comment to conversation
    await front.conversations.addComment(conversationId, body, authorId)

    return {
      added: true,
      // Front doesn't return comment ID from this endpoint
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      added: false,
      error: message,
    }
  }
}

// ============================================================================
// Standalone function for direct use
// ============================================================================

/**
 * Create a comment step function with pre-configured options.
 */
export function createCommentStep(options: AddCommentOptions) {
  return (input: CommentInput) => addSupportComment(input, options)
}

// ============================================================================
// Agent Decision Comment
// ============================================================================

/**
 * Context for formatting an agent decision comment.
 */
export interface DecisionCommentContext {
  /** Message category from classification */
  category: string
  /** Classification confidence (0-1) */
  confidence: number
  /** Agent's reasoning for the classification */
  reasoning?: string
  /** Route action taken */
  action: string
  /** Reason for the routing decision */
  actionReason?: string
  /** Customer email if found */
  customerEmail?: string
  /** Customer name if found */
  customerName?: string
  /** Number of purchases found */
  purchaseCount?: number
  /** Purchase product names */
  purchaseNames?: string[]
}

/**
 * Format an agent decision comment.
 * Explains the classification and routing decision with context.
 *
 * @example For spam:
 * ```
 * 🤖 Agent Decision: Silenced
 * Category: spam (98%)
 * Reasoning: Vendor outreach/partnership proposal
 * Action: No response needed.
 * ```
 *
 * @example For support:
 * ```
 * 🤖 Agent Decision: Responding
 * Category: support_access (98%)
 * Context: User joel@example.com found with 3 purchases
 * Action: Draft auto-approved and sent.
 * ```
 */
export function formatDecisionComment(context: DecisionCommentContext): string {
  const parts: string[] = []

  // Determine emoji and action label
  const actionEmoji = getActionEmoji(context.action)
  const actionLabel = getActionLabel(context.action)

  // Header
  parts.push(`${actionEmoji} **Agent Decision: ${actionLabel}**\n`)

  // Classification details
  const confidencePercent = Math.round(context.confidence * 100)
  parts.push(`**Category:** ${context.category} (${confidencePercent}%)`)

  if (context.reasoning) {
    parts.push(`**Reasoning:** ${context.reasoning}`)
  }

  // Customer context (if available)
  if (context.customerEmail) {
    const customerLine = context.customerName
      ? `${context.customerName} (${context.customerEmail})`
      : context.customerEmail
    parts.push(`**Customer:** ${customerLine}`)

    if (context.purchaseCount !== undefined) {
      if (context.purchaseCount > 0 && context.purchaseNames) {
        parts.push(
          `**Purchases:** ${context.purchaseCount} (${context.purchaseNames.join(', ')})`
        )
      } else {
        parts.push(`**Purchases:** None found`)
      }
    }
  }

  // Action explanation
  parts.push('')
  if (context.actionReason) {
    parts.push(`**Action:** ${context.actionReason}`)
  }

  return parts.join('\n')
}

/**
 * Get emoji for route action.
 */
function getActionEmoji(action: string): string {
  switch (action) {
    case 'respond':
      return '💬'
    case 'silence':
      return '🔇'
    case 'escalate_human':
      return '⚠️'
    case 'escalate_instructor':
      return '👨‍🏫'
    case 'escalate_urgent':
      return '🚨'
    case 'support_teammate':
      return '🤝'
    case 'catalog_voc':
      return '📣'
    default:
      return '🤖'
  }
}

/**
 * Get human-readable label for route action.
 */
function getActionLabel(action: string): string {
  switch (action) {
    case 'respond':
      return 'Responding'
    case 'silence':
      return 'Silenced'
    case 'escalate_human':
      return 'Escalated to Human'
    case 'escalate_instructor':
      return 'Escalated to Instructor'
    case 'escalate_urgent':
      return 'Urgent Escalation'
    case 'support_teammate':
      return 'Supporting Teammate'
    case 'catalog_voc':
      return 'Cataloging VOC'
    default:
      return action.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  }
}

/**
 * Options for adding a decision comment.
 */
export interface AddDecisionCommentOptions {
  /** Front API token */
  frontApiToken: string
  /** Teammate ID to attribute the comment to (optional) */
  authorId?: string
}

/**
 * Add an agent decision comment to a Front conversation.
 * Explains what the agent decided and why.
 *
 * @param conversationId - Front conversation ID
 * @param context - Decision context for formatting
 * @param options - Front API configuration
 * @returns Result with success status
 */
export async function addDecisionComment(
  conversationId: string,
  context: DecisionCommentContext,
  options: AddDecisionCommentOptions
): Promise<{ added: boolean; error?: string; durationMs: number }> {
  const startTime = Date.now()

  try {
    const front = createFrontClient({ apiToken: options.frontApiToken })
    const body = formatDecisionComment(context)

    await front.conversations.addComment(conversationId, body, options.authorId)

    return {
      added: true,
      durationMs: Date.now() - startTime,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(
      `[CommentStep] Failed to add decision comment to ${conversationId}:`,
      message
    )

    return {
      added: false,
      error: message,
      durationMs: Date.now() - startTime,
    }
  }
}
