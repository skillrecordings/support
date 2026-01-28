import { describe, expect, it } from 'bun:test'
import {
  computeSimilarity,
  detectEditType,
  detectEditTypes,
  markAsDeleted,
  normalizeText,
} from './edit-detection'

describe('Edit Detection', () => {
  describe('normalizeText', () => {
    it('strips HTML tags', () => {
      const result = normalizeText('<p>Hello <strong>World</strong></p>')
      expect(result).toBe('hello world')
    })

    it('strips tracking markers', () => {
      const result = normalizeText('Text <!-- agent-draft-id:abc123 --> more')
      expect(result).toBe('text more')
    })

    it('collapses whitespace', () => {
      const result = normalizeText('Hello    World\n\nTest')
      expect(result).toBe('hello world test')
    })

    it('handles HTML entities', () => {
      const result = normalizeText('Hello&nbsp;World&amp;Test')
      expect(result).toBe('hello world test')
    })

    it('returns empty string for null/undefined', () => {
      expect(normalizeText('')).toBe('')
      expect(normalizeText(null as any)).toBe('')
      expect(normalizeText(undefined as any)).toBe('')
    })
  })

  describe('computeSimilarity', () => {
    it('returns 1.0 for identical text', () => {
      expect(computeSimilarity('Hello World', 'Hello World')).toBe(1.0)
    })

    it('returns 1.0 for text with different casing', () => {
      expect(computeSimilarity('Hello World', 'hello world')).toBe(1.0)
    })

    it('returns high similarity for minor differences', () => {
      const sim = computeSimilarity(
        'Thank you for reaching out about your refund.',
        'Thank you for reaching out about your refund request.'
      )
      expect(sim).toBeGreaterThanOrEqual(0.7)
    })

    it('returns low similarity for major differences', () => {
      const sim = computeSimilarity(
        'Your refund has been processed.',
        'We cannot process refunds at this time. Please contact support.'
      )
      expect(sim).toBeLessThan(0.5)
    })

    it('returns 0.0 for empty strings', () => {
      expect(computeSimilarity('', 'Hello')).toBe(0.0)
      expect(computeSimilarity('Hello', '')).toBe(0.0)
    })
  })

  describe('detectEditType', () => {
    it('returns no_draft when original is null', () => {
      const result = detectEditType(null, 'Some sent message')
      expect(result.outcome).toBe('no_draft')
      expect(result.similarity).toBeUndefined()
    })

    it('returns unchanged for identical text', () => {
      const text = 'Thank you for contacting us about your order.'
      const result = detectEditType(text, text)
      expect(result.outcome).toBe('unchanged')
      expect(result.similarity).toBe(1.0)
    })

    it('returns unchanged for cosmetic HTML differences', () => {
      const original = 'Thank you for contacting us.'
      const sent = '<p>Thank you for contacting us.</p>'
      const result = detectEditType(original, sent)
      expect(result.outcome).toBe('unchanged')
      expect(result.similarity).toBeGreaterThanOrEqual(0.95)
    })

    it('returns minor_edit for small wording changes', () => {
      // Words mostly overlap but some changes
      const original =
        'Your refund has been processed successfully. You will see the amount in your account soon.'
      const sent =
        'Your refund has been processed successfully. You will see the amount in your account within 3-5 business days.'
      const result = detectEditType(original, sent)
      expect(result.outcome).toBe('minor_edit')
      expect(result.similarity).toBeGreaterThanOrEqual(0.7)
      expect(result.similarity).toBeLessThan(0.95)
    })

    it('returns major_rewrite for significant changes', () => {
      const original =
        'Your refund is approved. You will receive it within 5-7 days.'
      const sent =
        'Unfortunately we cannot process your refund at this time because the return window has closed. Please contact customer service for more options.'
      const result = detectEditType(original, sent)
      expect(result.outcome).toBe('major_rewrite')
      expect(result.similarity).toBeLessThan(0.7)
    })

    it('includes normalized text in result', () => {
      const result = detectEditType('<p>Hello World</p>', 'Hello World!')
      expect(result.originalText).toBe('hello world')
      expect(result.sentText).toBe('hello world!')
    })

    it('includes timestamp', () => {
      const before = new Date().toISOString()
      const result = detectEditType('test', 'test')
      const after = new Date().toISOString()
      expect(result.detectedAt).toBeTruthy()
      expect(result.detectedAt >= before).toBe(true)
      expect(result.detectedAt <= after).toBe(true)
    })

    it('respects custom thresholds', () => {
      const original = 'Hello World Test'
      const sent = 'Hello World'

      // With strict thresholds
      const strict = detectEditType(original, sent, {
        unchanged: 0.99,
        minorEdit: 0.9,
      })
      expect(strict.outcome).toBe('major_rewrite')

      // With lenient thresholds
      const lenient = detectEditType(original, sent, {
        unchanged: 0.5,
        minorEdit: 0.3,
      })
      expect(lenient.outcome).toBe('unchanged')
    })
  })

  describe('markAsDeleted', () => {
    it('returns deleted outcome', () => {
      const result = markAsDeleted('Draft that was not sent')
      expect(result.outcome).toBe('deleted')
      expect(result.originalText).toBe('draft that was not sent')
      expect(result.sentText).toBeUndefined()
      expect(result.similarity).toBeUndefined()
    })
  })

  describe('detectEditTypes', () => {
    it('processes multiple pairs', () => {
      const results = detectEditTypes([
        { original: 'Same text', sent: 'Same text' },
        { original: null, sent: 'Manual response' },
        { original: 'Very different', sent: 'Completely changed message here' },
      ])

      expect(results).toHaveLength(3)
      expect(results[0]!.outcome).toBe('unchanged')
      expect(results[1]!.outcome).toBe('no_draft')
      expect(results[2]!.outcome).toBe('major_rewrite')
    })
  })
})
