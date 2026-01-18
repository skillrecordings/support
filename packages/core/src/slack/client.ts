import { WebClient } from '@slack/web-api'
import type { Block } from '@slack/web-api'

let client: WebClient | null = null

/**
 * Get Slack WebClient singleton instance
 * Lazy initialization pattern - creates client on first call
 * @throws {Error} If SLACK_BOT_TOKEN environment variable is not set
 */
export function getSlackClient(): WebClient {
	if (!client) {
		const token = process.env.SLACK_BOT_TOKEN
		if (!token) {
			throw new Error('SLACK_BOT_TOKEN not set')
		}
		client = new WebClient(token)
	}
	return client
}

/**
 * Reset the Slack client singleton
 * @internal For testing only
 */
export function resetSlackClient(): void {
	client = null
}

/**
 * Post an approval message to a Slack channel
 * @param channel - Slack channel ID (e.g., 'C1234567890')
 * @param blocks - Slack Block Kit blocks
 * @param text - Fallback text for notifications
 * @returns Promise with timestamp and channel
 */
export async function postApprovalMessage(
	channel: string,
	blocks: Block[],
	text: string,
): Promise<{ ts: string; channel: string }> {
	const slackClient = getSlackClient()

	const result = await slackClient.chat.postMessage({
		channel,
		blocks,
		text,
	})

	if (!result.ok || !result.ts) {
		throw new Error('Failed to post message to Slack')
	}

	return {
		ts: result.ts,
		channel: result.channel!,
	}
}

/**
 * Update an existing approval message in Slack
 * @param channel - Slack channel ID
 * @param ts - Message timestamp (from postApprovalMessage)
 * @param blocks - Updated Slack Block Kit blocks
 * @param text - Updated fallback text
 */
export async function updateApprovalMessage(
	channel: string,
	ts: string,
	blocks: Block[],
	text: string,
): Promise<void> {
	const slackClient = getSlackClient()

	const result = await slackClient.chat.update({
		channel,
		ts,
		blocks,
		text,
	})

	if (!result.ok) {
		throw new Error('Failed to update message in Slack')
	}
}
