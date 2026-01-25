/**
 * Step 5b: COMMENT
 *
 * Adds a support comment to a conversation when a teammate is handling.
 * Used for the support_teammate action - provides research context without
 * drafting a customer-facing response.
 */

import { createFrontClient } from '@skillrecordings/front-sdk'
import type { CommentInput, CommentOutput, GatherOutput } from '../types'

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
