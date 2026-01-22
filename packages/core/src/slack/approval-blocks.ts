/**
 * Slack Block Kit message builder for approval requests.
 *
 * Builds interactive messages with:
 * - Header with action type
 * - Agent reasoning (mrkdwn)
 * - Action parameters (formatted key-value)
 * - Approve/Reject buttons with metadata
 *
 * @see https://api.slack.com/block-kit
 */

import type { SearchResult } from '@skillrecordings/memory/schemas'
import type { Block, KnownBlock } from '@slack/types'

/**
 * Input for building approval blocks.
 * Contains all data needed for approval request message.
 */
export type ApprovalBlocksInput = {
  /** Action ID for tracking */
  actionId: string
  /** Conversation ID */
  conversationId: string
  /** App ID */
  appId: string
  /** Action type (refund, license_transfer, etc) */
  actionType: string
  /** Action parameters */
  parameters: Record<string, unknown>
  /** Agent's reasoning for proposing this action */
  agentReasoning: string
  /** Cited memories (optional) */
  citedMemories?: SearchResult[]
  /** Customer email (optional) */
  customerEmail?: string
  /** Inbox ID (optional) */
  inboxId?: string
}

/**
 * Metadata embedded in button values.
 * Passed back in interaction payload when user clicks approve/reject.
 */
export type ApprovalMetadata = {
  actionId: string
  conversationId: string
  appId: string
}

/**
 * Capitalizes action type for display.
 * Converts snake_case or camelCase to Title Case.
 *
 * @example
 * capitalizeActionType('refund') -> 'Refund'
 * capitalizeActionType('license_transfer') -> 'License Transfer'
 * capitalizeActionType('issue_refund') -> 'Issue Refund'
 */
function capitalizeActionType(actionType: string): string {
  return actionType
    .replace(/_/g, ' ')
    .replace(/([A-Z])/g, ' $1')
    .trim()
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

/**
 * Keys to hide from parameters display (internal/redundant data)
 */
const HIDDEN_PARAMETER_KEYS = new Set([
  'toolCalls',
  'instructorTeammateId',
  'reason', // Already shown in agent reasoning
  'conversationId', // Already in context
  'appId', // Already in context
])

/**
 * Formats parameters as Block Kit fields array.
 * Each parameter becomes a mrkdwn field: "*key*: value"
 * Filters out internal/redundant keys.
 */
function formatParameters(
  parameters: Record<string, unknown>
): Array<{ type: 'mrkdwn'; text: string }> {
  const entries = Object.entries(parameters).filter(
    ([key]) => !HIDDEN_PARAMETER_KEYS.has(key)
  )

  // If all params are hidden, return empty
  if (entries.length === 0) return []

  return entries.map(([key, value]) => ({
    type: 'mrkdwn' as const,
    text: `*${formatKeyName(key)}:* ${formatValue(value)}`,
  }))
}

/**
 * Formats a camelCase or snake_case key as readable text
 */
function formatKeyName(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/([A-Z])/g, ' $1')
    .trim()
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
}

/**
 * Formats a value for display, truncating long strings
 */
function formatValue(value: unknown): string {
  if (value === null || value === undefined) return 'N/A'
  const str = String(value)
  if (str.length > 100) return str.slice(0, 100) + '...'
  return str
}

/**
 * Builds memory section showing cited memories with confidence scores.
 * Truncates long content to fit Slack's limits.
 */
function buildMemorySection(memories: SearchResult[]): KnownBlock[] {
  if (memories.length === 0) return []

  const memoryItems = memories
    .map((result) => {
      const confidencePercent = Math.round(
        result.memory.metadata.confidence * 100
      )
      const content =
        result.memory.content.length > 100
          ? result.memory.content.slice(0, 100) + '...'
          : result.memory.content
      return `[${confidencePercent}%] ${content}`
    })
    .join('\n\n')

  return [
    {
      type: 'divider',
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Relevant Memories:*\n${memoryItems}`,
      },
    },
  ]
}

/**
 * Builds memory action buttons for post-approval interactions.
 * Includes: Store as Memory, Upvote/Downvote for each cited memory.
 */
function buildMemoryActionButtons(
  metadata: ApprovalMetadata,
  memories: SearchResult[]
): KnownBlock {
  const elements = [
    // Store as Memory button
    {
      type: 'button' as const,
      text: {
        type: 'plain_text' as const,
        text: 'Store as Memory',
        emoji: true,
      },
      action_id: 'memory_store',
      value: JSON.stringify({
        actionId: metadata.actionId,
        conversationId: metadata.conversationId,
        appId: metadata.appId,
      }),
    },
  ]

  // Upvote/Downvote buttons for each cited memory
  for (const result of memories) {
    const memoryId = result.memory.id
    const collection = result.memory.metadata.collection

    elements.push({
      type: 'button' as const,
      text: {
        type: 'plain_text' as const,
        text: '👍 Upvote',
        emoji: true,
      },
      action_id: 'memory_upvote',
      value: JSON.stringify({ memory_id: memoryId, collection }),
    })

    elements.push({
      type: 'button' as const,
      text: {
        type: 'plain_text' as const,
        text: '👎 Downvote',
        emoji: true,
      },
      action_id: 'memory_downvote',
      value: JSON.stringify({ memory_id: memoryId, collection }),
    })
  }

  return {
    type: 'actions',
    elements,
  }
}

/**
 * Builds Slack Block Kit blocks for an approval request.
 *
 * Structure:
 * 1. Header - Action type
 * 2. Section - Agent reasoning
 * 3. Section - Action parameters (key-value fields)
 * 4. Actions - Approve (primary) and Reject (danger) buttons
 *
 * Button values contain JSON metadata: { actionId, conversationId, appId }
 *
 * @see https://api.slack.com/block-kit
 */
export function buildApprovalBlocks(input: ApprovalBlocksInput): KnownBlock[] {
  const {
    actionId,
    conversationId,
    appId,
    actionType,
    parameters,
    agentReasoning,
    citedMemories = [],
    customerEmail,
    inboxId,
  } = input

  // Metadata for button values
  const metadata: ApprovalMetadata = {
    actionId,
    conversationId,
    appId,
  }
  const metadataValue = JSON.stringify(metadata)

  // Front conversation URL
  const frontUrl = `https://app.frontapp.com/open/${conversationId}`

  // Build context line with app, customer, inbox
  const contextParts: string[] = [`*App:* ${appId}`]
  if (customerEmail) {
    contextParts.push(`*Customer:* ${customerEmail}`)
  }
  if (inboxId) {
    contextParts.push(`*Inbox:* ${inboxId}`)
  }

  const blocks: KnownBlock[] = [
    // Header
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `${capitalizeActionType(actionType)} Approval Request`,
        emoji: true,
      },
    },
    // Context: App, Customer, Inbox
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: contextParts.join('  |  '),
        },
      ],
    },
    // Agent reasoning (truncated for readability)
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text:
          agentReasoning.length > 300
            ? agentReasoning.slice(0, 300) + '...'
            : agentReasoning,
      },
    },
    // Parameters (only if there are visible ones)
    ...(formatParameters(parameters).length > 0
      ? [
          {
            type: 'section' as const,
            fields: formatParameters(parameters),
          },
        ]
      : []),
    // Memory section (if memories provided)
    ...buildMemorySection(citedMemories),
    // Approve/Reject/Open in Front buttons
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: 'Open in Front',
            emoji: true,
          },
          url: frontUrl,
        },
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: 'Approve',
            emoji: true,
          },
          style: 'primary',
          action_id: 'approve_action',
          value: metadataValue,
        },
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: 'Reject',
            emoji: true,
          },
          style: 'danger',
          action_id: 'reject_action',
          value: metadataValue,
        },
      ],
    },
  ]

  // Add memory action buttons if memories exist
  if (citedMemories.length > 0) {
    blocks.push(buildMemoryActionButtons(metadata, citedMemories))
  }

  return blocks
}
