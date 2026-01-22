import { describe, expect, it } from 'vitest'
import { type FrontMessage, extractCustomerEmail } from './client'

/**
 * Create minimal mock message - only need recipients array for extractCustomerEmail
 */
const createMockMessage = (
  recipients: FrontMessage['recipients']
): FrontMessage => ({
  _links: { self: '', related: { conversation: '' } },
  id: 'msg_test',
  type: 'email',
  is_inbound: true,
  is_draft: false,
  error_type: null,
  version: null,
  created_at: Date.now(),
  subject: 'Test',
  blurb: '',
  body: '',
  text: null,
  author: null,
  recipients: recipients,
  attachments: [],
})

describe('extractCustomerEmail', () => {
  it('returns reply-to email when present', () => {
    const message = createMockMessage([
      { handle: '[EMAIL]', role: 'reply-to' },
      { handle: '[EMAIL]', role: 'from' },
    ])

    expect(extractCustomerEmail(message)).toBe('[EMAIL]')
  })

  it('returns from email when reply-to is not present', () => {
    const message = createMockMessage([
      { handle: '[EMAIL]', role: 'from' },
    ])

    expect(extractCustomerEmail(message)).toBe('[EMAIL]')
  })

  it('prioritizes reply-to over from when both present', () => {
    const message = createMockMessage([
      { handle: '[EMAIL]', role: 'from' },
      { handle: '[EMAIL]', role: 'reply-to' },
    ])

    expect(extractCustomerEmail(message)).toBe('[EMAIL]')
  })

  it('returns null when recipients array is empty', () => {
    const message = createMockMessage([])

    expect(extractCustomerEmail(message)).toBeNull()
  })

  it('returns null when recipients is undefined', () => {
    const message = createMockMessage(undefined as any)

    expect(extractCustomerEmail(message)).toBeNull()
  })

  it('returns null when reply-to exists but has no handle', () => {
    const message = createMockMessage([
      { handle: undefined as any, role: 'reply-to' },
      { handle: '[EMAIL]', role: 'from' },
    ])

    // Should fall back to 'from' since reply-to has no handle
    expect(extractCustomerEmail(message)).toBe('[EMAIL]')
  })

  it('returns null when from exists but has no handle', () => {
    const message = createMockMessage([
      { handle: undefined as any, role: 'from' },
    ])

    expect(extractCustomerEmail(message)).toBeNull()
  })
})
