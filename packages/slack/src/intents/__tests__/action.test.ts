import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createActionConfirmationStore,
  requestActionConfirmation,
  resolveActionConfirmation,
} from '../../confirmations/action'
import { handleQuickAction, parseQuickAction } from '../action'

describe('quick action parsing', () => {
  it('parses approve and send', () => {
    expect(parseQuickAction('approve and send')).toEqual({
      type: 'approve_send',
    })
  })

  it('parses escalate to assignee', () => {
    expect(parseQuickAction('escalate to Jane Doe')).toEqual({
      type: 'escalate',
      assignee: 'Jane Doe',
    })
  })
})

describe('quick action confirmations', () => {
  it('handles confirmation flow', () => {
    const store = createActionConfirmationStore()
    const action = { type: 'approve_send' } as const
    const context = {
      conversationId: 'cnv_123',
      draftText: 'Hello there, this is the draft response to send.',
      recipientEmail: 'customer@example.com',
      threadTs: '1700000000.000100',
      channel: 'C123',
    }

    const request = requestActionConfirmation({
      store,
      threadTs: context.threadTs,
      action,
      context,
    })

    expect(request.message).toContain('Ready to send')
    expect(request.message).toContain('customer@example.com')
    expect(store.get(context.threadTs)).toBeDefined()

    const confirm = resolveActionConfirmation(store, context.threadTs, 'yes')
    expect(confirm.status).toBe('confirm')
    if (confirm.status === 'confirm') {
      expect(confirm.action).toEqual(action)
      expect(confirm.context.conversationId).toBe('cnv_123')
    }
    expect(store.get(context.threadTs)).toBeUndefined()

    requestActionConfirmation({
      store,
      threadTs: context.threadTs,
      action,
      context,
    })

    const cancel = resolveActionConfirmation(store, context.threadTs, 'cancel')
    expect(cancel.status).toBe('cancel')
    expect(store.get(context.threadTs)).toBeUndefined()
  })
})

describe('quick action handlers', () => {
  const baseContext = {
    conversationId: 'cnv_456',
    draftText: 'Draft text',
    threadTs: '1700000000.000200',
    channel: 'C456',
    requestedBy: 'U999',
  }

  const logger = vi.fn().mockResolvedValue(undefined)
  const initializeAxiom = vi.fn()

  beforeEach(() => {
    logger.mockClear()
    initializeAxiom.mockClear()
  })

  it('handles Front API errors gracefully', async () => {
    const frontClient = {
      raw: {
        post: vi.fn().mockRejectedValue(new Error('Front down')),
      },
      conversations: {
        update: vi.fn(),
        updateAssignee: vi.fn(),
        addComment: vi.fn(),
      },
    }

    const result = await handleQuickAction(
      { type: 'approve_send' },
      baseContext,
      { frontClient, logger, initializeAxiom }
    )

    expect(result.ok).toBe(false)
    expect(result.message).toContain("couldn't send")
    expect(frontClient.conversations.update).not.toHaveBeenCalled()
  })

  it('logs actions to Axiom', async () => {
    const frontClient = {
      raw: {
        post: vi.fn(),
      },
      conversations: {
        update: vi.fn().mockResolvedValue({}),
        updateAssignee: vi.fn(),
        addComment: vi.fn(),
      },
    }

    const result = await handleQuickAction({ type: 'archive' }, baseContext, {
      frontClient,
      logger,
      initializeAxiom,
    })

    expect(result.ok).toBe(true)
    expect(logger).toHaveBeenCalledWith(
      'info',
      'slack.quick_action',
      expect.objectContaining({
        actionType: 'archive',
        conversationId: baseContext.conversationId,
        success: true,
      })
    )
  })
})
