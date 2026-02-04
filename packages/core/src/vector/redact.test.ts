import { describe, expect, it } from 'vitest'
import { redactPII } from './redact'

describe('redactPII', () => {
  it('redacts email addresses', () => {
    const text = 'Contact me at john@example.com for details'
    const result = redactPII(text)
    expect(result).toBe('Contact me at [EMAIL] for details')
  })

  it('redacts multiple emails', () => {
    const text = 'Send to alice@test.com and bob@example.org'
    const result = redactPII(text)
    expect(result).toBe('Send to [EMAIL] and [EMAIL]')
  })

  it('redacts phone numbers in various formats', () => {
    expect(redactPII('Call (555) 123-4567')).toBe('Call [PHONE]')
    expect(redactPII('Text 555-123-4567')).toBe('Text [PHONE]')
    expect(redactPII('Dial +1 555 123 4567')).toBe('Dial [PHONE]')
    expect(redactPII('Try 5551234567')).toBe('Try [PHONE]')
  })

  it('redacts credit card numbers', () => {
    expect(redactPII('Card: 4532-1234-5678-9012')).toBe('Card: [CARD]')
    expect(redactPII('Number 4532 1234 5678 9012')).toBe('Number [CARD]')
    expect(redactPII('Pay with 4532123456789012')).toBe('Pay with [CARD]')
  })

  it('redacts known names (case insensitive)', () => {
    const text = 'Hello John Smith, how is john smith doing?'
    const result = redactPII(text, ['John Smith'])
    expect(result).toBe('Hello [NAME], how is [NAME] doing?')
  })

  it('redacts multiple known names', () => {
    const text = 'Alice and Bob met with Charlie'
    const result = redactPII(text, ['Alice', 'Bob', 'Charlie'])
    expect(result).toBe('[NAME] and [NAME] met with [NAME]')
  })

  it('handles text with multiple PII types', () => {
    const text =
      'Contact John Doe at john@example.com or 555-123-4567, card 4532-1234-5678-9012'
    const result = redactPII(text, ['John Doe'])
    expect(result).toBe('Contact [NAME] at [EMAIL] or [PHONE], card [CARD]')
  })

  it('returns original text when no PII detected', () => {
    const text = 'This is a clean message'
    expect(redactPII(text)).toBe('This is a clean message')
  })

  it('handles empty string', () => {
    expect(redactPII('')).toBe('')
  })

  it('handles names with special regex characters', () => {
    const text = "Hello Mr. O'Brien and Ms. (Smith)"
    const result = redactPII(text, ["Mr. O'Brien", 'Ms. (Smith)'])
    expect(result).toBe('Hello [NAME] and [NAME]')
  })
})
