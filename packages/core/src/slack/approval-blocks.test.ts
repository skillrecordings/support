import { describe, expect, it } from 'vitest'
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
      },
      agentReasoning:
        'Customer requested refund within 30-day window. Product not accessed.',
      customerEmail: '[EMAIL]',
      inboxId: 'inbox_123',
    })

    // Header, Context, Reasoning, Parameters, Actions
    expect(blocks).toHaveLength(5)

    // Header section
    expect(blocks[0]).toMatchObject({
      type: 'header',
      text: {
        type: 'plain_text',
        text: expect.stringContaining('Refund'),
      },
    })

    // Context section (app, customer, inbox)
    expect(blocks[1]).toMatchObject({
      type: 'context',
      elements: expect.arrayContaining([
        expect.objectContaining({
          type: 'mrkdwn',
          text: expect.stringContaining('app_789'),
        }),
      ]),
    })

    // Agent reasoning section
    expect(blocks[2]).toMatchObject({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: expect.stringContaining(
          'Customer requested refund within 30-day window'
        ),
      },
    })

    // Parameters section
    expect(blocks[3]).toMatchObject({
      type: 'section',
      fields: expect.arrayContaining([
        expect.objectContaining({
          type: 'mrkdwn',
          text: expect.stringContaining('1000'),
        }),
      ]),
    })

    // Actions section with Open in Front, Approve, Reject buttons
    const actions = blocks[4] as any
    expect(actions.type).toBe('actions')
    expect(actions.elements).toHaveLength(3)

    // Open in Front button (link button, no action_id value)
    const frontButton = actions.elements[0]
    expect(frontButton.type).toBe('button')
    expect(frontButton.text.text).toBe('Open in Front')
    expect(frontButton.url).toBe('https://app.frontapp.com/open/cnv_456')

    // Approve button
    const approveButton = actions.elements[1]
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
    const rejectButton = actions.elements[2]
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

    // Header, Context, Reasoning, Parameters, Actions
    expect(blocks).toHaveLength(5)

    // Header section
    expect(blocks[0]).toMatchObject({
      type: 'header',
      text: {
        type: 'plain_text',
        text: expect.stringContaining('License Transfer'),
      },
    })

    // Context section
    expect(blocks[1]).toMatchObject({
      type: 'context',
    })

    // Agent reasoning
    expect(blocks[2]).toMatchObject({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: expect.stringContaining('Previous transfers: 0'),
      },
    })

    // Parameters
    expect(blocks[3]).toMatchObject({
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

    // Actions (3 buttons: Open in Front, Approve, Reject)
    const actions = blocks[4] as any
    expect(actions.type).toBe('actions')
    expect(actions.elements).toHaveLength(3)
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

    // Header, Context, Reasoning, Parameters, Actions = 5 blocks
    // Parameters is at index 3
    const parametersSection = blocks[3] as any
    expect(parametersSection.fields).toBeDefined()
    expect(parametersSection.fields.length).toBeGreaterThan(0)

    // Check that each parameter is formatted as "*Key:* value" (bold key with colon)
    parametersSection.fields.forEach((field: any) => {
      expect(field.text).toMatch(/\*[\w\s]+:\* .+/)
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

    // Header, Context, Reasoning, Actions (no parameters section when empty)
    expect(blocks).toHaveLength(4)

    // Verify no parameters section exists (actions should be at index 3)
    const actions = blocks[3] as any
    expect(actions.type).toBe('actions')
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

    // Empty params = 4 blocks, actions at index 3
    const actions = blocks[3] as any
    // Buttons: [Open in Front, Approve, Reject]
    const approveButton = actions.elements[1]
    const rejectButton = actions.elements[2]

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

  it('should filter out internal parameters', () => {
    const blocks = buildApprovalBlocks({
      actionId: 'act_filter',
      conversationId: 'cnv_filter',
      appId: 'app_filter',
      actionType: 'route_to_instructor',
      parameters: {
        instructorTeammateId: 'tea_internal', // Should be hidden
        reason: 'Internal reason', // Should be hidden (shown in reasoning)
        conversationId: 'cnv_dupe', // Should be hidden
        appId: 'app_dupe', // Should be hidden
        toolCalls: ['call1', 'call2'], // Should be hidden
        visibleParam: 'should show', // Should be visible
      },
      agentReasoning: 'Testing parameter filtering',
    })

    // Find the parameters section (should have only visibleParam)
    const paramsSection = blocks.find(
      (b: any) => b.type === 'section' && b.fields
    ) as any
    expect(paramsSection).toBeDefined()
    expect(paramsSection.fields).toHaveLength(1)
    expect(paramsSection.fields[0].text).toContain('should show')
  })

  it('should include customer email and inbox in context', () => {
    const blocks = buildApprovalBlocks({
      actionId: 'act_ctx',
      conversationId: 'cnv_ctx',
      appId: 'total-typescript',
      actionType: 'refund',
      parameters: {},
      agentReasoning: 'Context test',
      customerEmail: '[EMAIL]',
      inboxId: 'inbox_support',
    })

    // Context is at index 1
    const context = blocks[1] as any
    expect(context.type).toBe('context')
    expect(context.elements[0].text).toContain('total-typescript')
    expect(context.elements[0].text).toContain('[EMAIL]')
    expect(context.elements[0].text).toContain('inbox_support')
  })
})
