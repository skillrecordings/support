/**
 * Slack Failure Notifications for HITL System
 *
 * Sends immediate Slack notifications when tool executions fail,
 * allowing humans to intervene quickly.
 *
 * @see Issue #129 - HITL Slack Failure Notifications
 */

import type { KnownBlock } from '@slack/types'
import { log } from '../observability/axiom'
import { postMessage } from '../slack/client'

/**
 * Tool failure details for notification
 */
export interface ToolFailureDetails {
  /** The action ID that failed */
  actionId: string
  /** Front conversation ID */
  conversationId: string
  /** App ID (e.g., 'total-typescript') */
  appId: string
  /** Tool name that failed (e.g., 'processRefund', 'updateEmail') */
  toolName: string
  /** Human-readable error message */
  errorMessage: string
  /** Error code if available (e.g., 'STRIPE_ERROR', 'RATE_LIMITED') */
  errorCode?: string
  /** Tool parameters (sanitized - no secrets) */
  parameters?: Record<string, unknown>
  /** Customer email if available */
  customerEmail?: string
  /** Who approved this action */
  approvedBy?: string
  /** When the action was approved */
  approvedAt?: string
}

/**
 * Sensitive parameter key patterns to redact from notifications
 * Matches against lowercase key names
 */
const SENSITIVE_KEY_PATTERNS = [
  'password',
  'secret',
  'token',
  'apikey',
  'api_key',
  'creditcard',
  'ssn',
  'accesstoken',
  'access_token',
  'refreshtoken',
  'refresh_token',
  'privatekey',
  'private_key',
]

/**
 * Check if a key should be redacted
 */
function isSensitiveKey(key: string): boolean {
  const lowerKey = key.toLowerCase()
  return SENSITIVE_KEY_PATTERNS.some(
    (pattern) => lowerKey.includes(pattern) || lowerKey === pattern
  )
}

/**
 * Sanitize parameters by redacting sensitive values
 */
function sanitizeParameters(
  params: Record<string, unknown>
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(params)) {
    if (isSensitiveKey(key)) {
      sanitized[key] = '[REDACTED]'
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeParameters(value as Record<string, unknown>)
    } else {
      sanitized[key] = value
    }
  }

  return sanitized
}

/**
 * Format error code for display
 */
function formatErrorCode(code?: string): string {
  if (!code) return 'UNKNOWN'
  return code.replace(/_/g, ' ').toUpperCase()
}

/**
 * Build Slack Block Kit blocks for a failure notification
 */
export function buildFailureBlocks(details: ToolFailureDetails): KnownBlock[] {
  const {
    actionId,
    conversationId,
    appId,
    toolName,
    errorMessage,
    errorCode,
    parameters,
    customerEmail,
    approvedBy,
    approvedAt,
  } = details

  const frontUrl = `https://app.frontapp.com/open/${conversationId}`

  const contextParts: string[] = [
    `*App:* ${appId}`,
    `*Tool:* ${toolName}`,
    `*Error:* ${formatErrorCode(errorCode)}`,
  ]
  if (customerEmail) {
    contextParts.push(`*Customer:* ${customerEmail}`)
  }

  const blocks: KnownBlock[] = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: '🚨 Tool Execution Failed',
        emoji: true,
      },
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: contextParts.join('  |  '),
        },
      ],
    },
    {
      type: 'divider',
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Error Message:*\n${errorMessage.length > 500 ? errorMessage.slice(0, 500) + '...' : errorMessage}`,
      },
    },
  ]

  if (approvedBy) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Approved by:* ${approvedBy}${approvedAt ? ` at ${approvedAt}` : ''}`,
      },
    })
  }

  if (parameters && Object.keys(parameters).length > 0) {
    const sanitized = sanitizeParameters(parameters)
    const paramText = Object.entries(sanitized)
      .map(([key, value]) => `• *${key}:* ${JSON.stringify(value)}`)
      .join('\n')

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Parameters:*\n${paramText.length > 400 ? paramText.slice(0, 400) + '...' : paramText}`,
      },
    })
  }

  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `Action ID: \`${actionId}\``,
      },
    ],
  })

  blocks.push({
    type: 'actions',
    elements: [
      {
        type: 'button',
        text: {
          type: 'plain_text',
          text: '🔗 Open in Front',
          emoji: true,
        },
        url: frontUrl,
        action_id: 'open_front_failure',
      },
    ],
  })

  return blocks
}

/**
 * Send a failure notification to Slack
 */
export async function sendFailureNotification(
  details: ToolFailureDetails,
  channel?: string
): Promise<{
  success: boolean
  ts?: string
  channel?: string
  error?: string
}> {
  const targetChannel = channel || process.env.SLACK_APPROVAL_CHANNEL

  if (!targetChannel) {
    await log(
      'error',
      'SLACK_APPROVAL_CHANNEL not configured for failure notification',
      {
        actionId: details.actionId,
        conversationId: details.conversationId,
        toolName: details.toolName,
      }
    )
    return {
      success: false,
      error: 'SLACK_APPROVAL_CHANNEL not configured',
    }
  }

  try {
    const blocks = buildFailureBlocks(details)

    await log('debug', 'sending failure notification to Slack', {
      actionId: details.actionId,
      conversationId: details.conversationId,
      toolName: details.toolName,
      errorCode: details.errorCode,
      channel: targetChannel,
    })

    const result = await postMessage(targetChannel, {
      text: `🚨 Tool execution failed: ${details.toolName} - ${details.errorMessage.slice(0, 100)}`,
      blocks,
    })

    await log('info', 'failure notification sent to Slack', {
      actionId: details.actionId,
      conversationId: details.conversationId,
      toolName: details.toolName,
      errorCode: details.errorCode,
      channel: result.channel,
      messageTs: result.ts,
    })

    return {
      success: true,
      ts: result.ts,
      channel: result.channel,
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)

    await log('error', 'failed to send failure notification to Slack', {
      actionId: details.actionId,
      conversationId: details.conversationId,
      toolName: details.toolName,
      error: errorMessage,
    })

    return {
      success: false,
      error: errorMessage,
    }
  }
}

/**
 * Notify about a tool failure from execute-approved-action
 */
export async function notifyToolFailure(params: {
  actionId: string
  conversationId: string
  appId: string
  toolName: string
  toolResult: { success: boolean; error?: { code?: string; message?: string } }
  parameters?: Record<string, unknown>
  customerEmail?: string
  approvedBy?: string
  approvedAt?: string
}): Promise<{ success: boolean; error?: string }> {
  const {
    actionId,
    conversationId,
    appId,
    toolName,
    toolResult,
    parameters,
    customerEmail,
    approvedBy,
    approvedAt,
  } = params

  if (toolResult.success) {
    return { success: true }
  }

  const errorMessage =
    toolResult.error?.message || 'Tool execution failed with unknown error'
  const errorCode = toolResult.error?.code

  return sendFailureNotification({
    actionId,
    conversationId,
    appId,
    toolName,
    errorMessage,
    errorCode,
    parameters,
    customerEmail,
    approvedBy,
    approvedAt,
  })
}
