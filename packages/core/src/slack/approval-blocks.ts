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
 * Formats parameters as Block Kit fields array.
 * Each parameter becomes a mrkdwn field: "*key*: value"
 */
function formatParameters(
	parameters: Record<string, unknown>,
): Array<{ type: 'mrkdwn'; text: string }> {
	return Object.entries(parameters).map(([key, value]) => ({
		type: 'mrkdwn' as const,
		text: `*${key}*: ${String(value)}`,
	}))
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
	} = input

	// Metadata for button values
	const metadata: ApprovalMetadata = {
		actionId,
		conversationId,
		appId,
	}
	const metadataValue = JSON.stringify(metadata)

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
		// Agent reasoning
		{
			type: 'section',
			text: {
				type: 'mrkdwn',
				text: `*Agent Reasoning:*\n${agentReasoning}`,
			},
		},
		// Parameters
		{
			type: 'section',
			fields: formatParameters(parameters),
		},
		// Approve/Reject buttons
		{
			type: 'actions',
			elements: [
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

	return blocks
}
