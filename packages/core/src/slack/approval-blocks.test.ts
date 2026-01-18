import { describe, it, expect } from 'vitest'
import { buildApprovalBlocks } from './approval-blocks'

describe('buildApprovalBlocks', () => {
	it('should build Block Kit blocks for refund approval', () => {
		const blocks = buildApprovalBlocks({
			actionId: 'act_123',
			conversationId: 'cnv_456',
			appId: 'app_789',
			actionType: 'refund',
			parameters: {
				amount: 1000,
				currency: 'USD',
				reason: 'Not satisfied with product',
			},
			agentReasoning:
				'Customer requested refund within 30-day window. Product not accessed.',
		})

		expect(blocks).toHaveLength(4)

		// Header section
		expect(blocks[0]).toMatchObject({
			type: 'header',
			text: {
				type: 'plain_text',
				text: expect.stringContaining('Refund'),
			},
		})

		// Agent reasoning section
		expect(blocks[1]).toMatchObject({
			type: 'section',
			text: {
				type: 'mrkdwn',
				text: expect.stringContaining(
					'Customer requested refund within 30-day window',
				),
			},
		})

		// Parameters section
		expect(blocks[2]).toMatchObject({
			type: 'section',
			fields: expect.arrayContaining([
				expect.objectContaining({
					type: 'mrkdwn',
					text: expect.stringContaining('1000'),
				}),
			]),
		})

		// Actions section with approve/reject buttons
		const actions = blocks[3] as any
		expect(actions.type).toBe('actions')
		expect(actions.elements).toHaveLength(2)

		// Approve button
		const approveButton = actions.elements[0]
		expect(approveButton.type).toBe('button')
		expect(approveButton.text.text).toBe('Approve')
		expect(approveButton.style).toBe('primary')
		expect(approveButton.action_id).toBe('approve_action')
		expect(JSON.parse(approveButton.value)).toEqual({
			actionId: 'act_123',
			conversationId: 'cnv_456',
			appId: 'app_789',
		})

		// Reject button
		const rejectButton = actions.elements[1]
		expect(rejectButton.type).toBe('button')
		expect(rejectButton.text.text).toBe('Reject')
		expect(rejectButton.style).toBe('danger')
		expect(rejectButton.action_id).toBe('reject_action')
		expect(JSON.parse(rejectButton.value)).toEqual({
			actionId: 'act_123',
			conversationId: 'cnv_456',
			appId: 'app_789',
		})
	})

	it('should build Block Kit blocks for license transfer approval', () => {
		const blocks = buildApprovalBlocks({
			actionId: 'act_456',
			conversationId: 'cnv_789',
			appId: 'app_012',
			actionType: 'license_transfer',
			parameters: {
				fromEmail: '[EMAIL]',
				toEmail: '[EMAIL]',
				product: 'Total TypeScript',
			},
			agentReasoning:
				'Customer requested transfer to new email. Previous transfers: 0.',
		})

		expect(blocks).toHaveLength(4)

		// Header section
		expect(blocks[0]).toMatchObject({
			type: 'header',
			text: {
				type: 'plain_text',
				text: expect.stringContaining('License Transfer'),
			},
		})

		// Agent reasoning
		expect(blocks[1]).toMatchObject({
			type: 'section',
			text: {
				type: 'mrkdwn',
				text: expect.stringContaining('Previous transfers: 0'),
			},
		})

		// Parameters
		expect(blocks[2]).toMatchObject({
			type: 'section',
			fields: expect.arrayContaining([
				expect.objectContaining({
					type: 'mrkdwn',
					text: expect.stringContaining('[EMAIL]'),
				}),
				expect.objectContaining({
					type: 'mrkdwn',
					text: expect.stringContaining('[EMAIL]'),
				}),
			]),
		})

		// Actions
		expect(blocks[3]).toMatchObject({
			type: 'actions',
		})
	})

	it('should format parameters as key-value fields', () => {
		const blocks = buildApprovalBlocks({
			actionId: 'act_789',
			conversationId: 'cnv_012',
			appId: 'app_345',
			actionType: 'custom_action',
			parameters: {
				key1: 'value1',
				key2: 123,
				key3: true,
			},
			agentReasoning: 'Testing parameter formatting',
		})

		const parametersSection = blocks[2] as any
		expect(parametersSection.fields).toBeDefined()
		expect(parametersSection.fields.length).toBeGreaterThan(0)

		// Check that each parameter is formatted as "Key: value"
		parametersSection.fields.forEach((field: any) => {
			expect(field.text).toMatch(/\*\w+\*: .+/)
		})
	})

	it('should handle empty parameters', () => {
		const blocks = buildApprovalBlocks({
			actionId: 'act_empty',
			conversationId: 'cnv_empty',
			appId: 'app_empty',
			actionType: 'no_params',
			parameters: {},
			agentReasoning: 'No parameters needed',
		})

		expect(blocks).toHaveLength(4)
		const parametersSection = blocks[2] as any
		expect(parametersSection.fields).toEqual([])
	})

	it('should capitalize action type in header', () => {
		const blocks = buildApprovalBlocks({
			actionId: 'act_cap',
			conversationId: 'cnv_cap',
			appId: 'app_cap',
			actionType: 'issue_refund',
			parameters: {},
			agentReasoning: 'Testing capitalization',
		})

		const header = blocks[0] as any
		expect(header.text.text).toBe('Issue Refund Approval Request')
	})

	it('should include metadata in button values as JSON', () => {
		const blocks = buildApprovalBlocks({
			actionId: 'act_meta',
			conversationId: 'cnv_meta',
			appId: 'app_meta',
			actionType: 'test',
			parameters: {},
			agentReasoning: 'Testing metadata',
		})

		const actions = blocks[3] as any
		const approveButton = actions.elements[0]
		const rejectButton = actions.elements[1]

		const approveValue = JSON.parse(approveButton.value)
		expect(approveValue).toEqual({
			actionId: 'act_meta',
			conversationId: 'cnv_meta',
			appId: 'app_meta',
		})

		const rejectValue = JSON.parse(rejectButton.value)
		expect(rejectValue).toEqual({
			actionId: 'act_meta',
			conversationId: 'cnv_meta',
			appId: 'app_meta',
		})
	})
})
