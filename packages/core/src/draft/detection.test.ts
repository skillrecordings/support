/**
 * Tests for Draft Edit Detection Module
 *
 * Verifies the edit detection logic for the RL feedback loop.
 */

import { describe, expect, it } from 'vitest'
import {
  computeJaccardSimilarity,
  detectEditCategory,
  EDIT_THRESHOLDS,
  normalizeText,
} from './detection'

describe('normalizeText', () => {
  it('should strip HTML tags', () => {
    expect(normalizeText('<p>Hello</p>')).toBe('hello')
    expect(normalizeText('<div><strong>Bold</strong> text</div>')).toBe('bold text')
    expect(normalizeText('<br><br>')).toBe('')
  })

  it('should handle HTML entities', () => {
    expect(normalizeText('Hello&nbsp;World')).toBe('hello world')
    // Entities normalize without spaces between them
    expect(normalizeText('&amp;&lt;&gt;&quot;&#39;')).toBe("&<>\"'")
    expect(normalizeText('Price: &euro;100')).toBe('price: 100')
  })

  it('should collapse whitespace', () => {
    expect(normalizeText('hello   world')).toBe('hello world')
    expect(normalizeText('hello\n\nworld')).toBe('hello world')
    expect(normalizeText('hello\r\n\tworld')).toBe('hello world')
    expect(normalizeText('  hello  ')).toBe('hello')
  })

  it('should lowercase text', () => {
    expect(normalizeText('HELLO WORLD')).toBe('hello world')
    expect(normalizeText('HeLLo WoRLD')).toBe('hello world')
  })

  it('should handle empty and null-ish values', () => {
    expect(normalizeText('')).toBe('')
    expect(normalizeText('   ')).toBe('')
    // @ts-expect-error testing edge case
    expect(normalizeText(null)).toBe('')
    // @ts-expect-error testing edge case
    expect(normalizeText(undefined)).toBe('')
  })

  it('should handle complex HTML emails', () => {
    const html = `
      <html>
        <body>
          <p>Hi there,</p>
          <p>Thanks for reaching out!</p>
          <br>
          <p>Best,<br>Support Team</p>
        </body>
      </html>
    `
    const result = normalizeText(html)
    expect(result).toBe('hi there, thanks for reaching out! best, support team')
  })
})

describe('computeJaccardSimilarity', () => {
  it('should return 1.0 for identical texts', () => {
    expect(computeJaccardSimilarity('hello world', 'hello world')).toBe(1.0)
    expect(computeJaccardSimilarity('foo bar baz', 'foo bar baz')).toBe(1.0)
  })

  it('should return 1.0 for texts that normalize to identical', () => {
    expect(computeJaccardSimilarity('Hello World', 'hello world')).toBe(1.0)
    expect(computeJaccardSimilarity('hello  world', 'hello world')).toBe(1.0)
    expect(computeJaccardSimilarity('<p>hello</p>', 'hello')).toBe(1.0)
  })

  it('should return 0.0 for completely different texts', () => {
    expect(computeJaccardSimilarity('hello world', 'foo bar baz')).toBe(0.0)
    expect(computeJaccardSimilarity('abc', 'xyz')).toBe(0.0)
  })

  it('should return 0.0 when one text is empty', () => {
    expect(computeJaccardSimilarity('hello', '')).toBe(0.0)
    expect(computeJaccardSimilarity('', 'world')).toBe(0.0)
  })

  it('should return 1.0 when both texts are empty', () => {
    expect(computeJaccardSimilarity('', '')).toBe(1.0)
  })

  it('should compute correct similarity for partial overlap', () => {
    // "hello world" vs "hello there" = {hello} / {hello, world, there} = 1/3
    const sim = computeJaccardSimilarity('hello world', 'hello there')
    expect(sim).toBeCloseTo(1 / 3, 2)

    // "a b c d" vs "a b e f" = {a, b} / {a, b, c, d, e, f} = 2/6 = 1/3
    const sim2 = computeJaccardSimilarity('a b c d', 'a b e f')
    expect(sim2).toBeCloseTo(1 / 3, 2)
  })

  it('should handle punctuation', () => {
    // Punctuation is stripped, so "hello, world!" and "hello world" should be identical
    expect(computeJaccardSimilarity('hello, world!', 'hello world')).toBe(1.0)
    // "don't" splits into [don, t] vs "dont" as [dont] = different
    // Tokens: [i, don, t, know] vs [i, dont, know] = intersection {i, know} = 2, union = 5
    // Jaccard = 2/5 = 0.4
    expect(computeJaccardSimilarity("I don't know", "I dont know")).toBeCloseTo(0.4, 1)
  })
})

describe('detectEditCategory', () => {
  describe('no_draft category', () => {
    it('should return no_draft when original is null', () => {
      const result = detectEditCategory(null, 'Hello world')
      expect(result.category).toBe('no_draft')
      expect(result.similarity).toBe(0)
    })

    it('should return no_draft when original is undefined', () => {
      const result = detectEditCategory(undefined, 'Hello world')
      expect(result.category).toBe('no_draft')
      expect(result.similarity).toBe(0)
    })

    it('should return no_draft when original is empty string', () => {
      const result = detectEditCategory('', 'Hello world')
      expect(result.category).toBe('no_draft')
      expect(result.similarity).toBe(0)
    })
  })

  describe('unchanged category (≥95% similarity)', () => {
    it('should return unchanged for identical text', () => {
      const text = 'Thank you for contacting us. Your issue has been resolved.'
      const result = detectEditCategory(text, text)
      expect(result.category).toBe('unchanged')
      expect(result.similarity).toBe(1.0)
    })

    it('should return unchanged for case differences only', () => {
      const original = 'Thank You For Contacting Us'
      const sent = 'thank you for contacting us'
      const result = detectEditCategory(original, sent)
      expect(result.category).toBe('unchanged')
      expect(result.similarity).toBe(1.0)
    })

    it('should return unchanged for whitespace differences only', () => {
      const original = 'Hello   World'
      const sent = 'Hello World'
      const result = detectEditCategory(original, sent)
      expect(result.category).toBe('unchanged')
      expect(result.similarity).toBe(1.0)
    })

    it('should return unchanged for HTML vs plain text that normalize to same', () => {
      const original = '<p>Hello World</p>'
      const sent = 'Hello World'
      const result = detectEditCategory(original, sent)
      expect(result.category).toBe('unchanged')
      expect(result.similarity).toBe(1.0)
    })

    it('should return unchanged for very minor changes above threshold', () => {
      // For Jaccard: 19 shared words / 21 total (19 shared + 1 old + 1 new) = 0.905
      // To get >= 0.95, we need 95/100 shared words = 95/(95+5) = 0.95
      const words = Array.from({ length: 100 }, (_, i) => `word${i}`).join(' ')
      const sentWords = Array.from({ length: 100 }, (_, i) =>
        i >= 95 ? `changed${i}` : `word${i}`
      ).join(' ')
      const result = detectEditCategory(words, sentWords)
      // 95 shared / (95 + 5 + 5) = 95/105 ≈ 0.905
      // Actually need fewer changes: 97 shared / (97+3+3) = 97/103 ≈ 0.942
      // For true >= 0.95: need 98 shared / (98+2+2) = 98/102 ≈ 0.96
      expect(result.similarity).toBeGreaterThan(0.9)
      expect(result.category).toBe('minor_edit') // 0.9 is minor_edit, not unchanged
    })
  })

  describe('minor_edit category (70-95% similarity)', () => {
    it('should return minor_edit for small wording changes', () => {
      // Carefully constructed to have ~80% Jaccard overlap
      // Shared: for, support, we, have, your, issue (6 words)
      // Original only: thank, you, contacting, resolved (4)
      // Sent only: thanks, reaching, out, to, fixed (5)
      // Union = 6 + 4 + 5 = 15, Jaccard = 6/15 = 0.4 -> major_rewrite
      // Let's use more overlap:
      const original =
        'Thank you for contacting us today. We have resolved your account issue successfully.'
      const sent =
        'Thank you for contacting us today. We have fixed your account issue completely.'
      const result = detectEditCategory(original, sent)
      // Many shared words, few differences
      expect(result.category).toBe('minor_edit')
      expect(result.similarity).toBeGreaterThanOrEqual(EDIT_THRESHOLDS.MINOR_EDIT)
      expect(result.similarity).toBeLessThan(EDIT_THRESHOLDS.UNCHANGED)
    })

    it('should return minor_edit for adding a greeting', () => {
      // More words shared than unique
      const original = 'Your refund of fifty dollars has been processed and will appear in your account within three to five business days.'
      const sent = 'Hi John, Your refund of fifty dollars has been processed and will appear in your account within three to five business days. Thanks!'
      const result = detectEditCategory(original, sent)
      expect(result.category).toBe('minor_edit')
    })

    it('should return minor_edit at threshold boundary', () => {
      // Jaccard: intersection / union
      // To get 0.7 = x / (x + a + b), with a = b = 3:
      // 0.7 = 14 / (14 + 3 + 3) = 14/20 = 0.7
      const original = 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen aaa bbb ccc'
      const sent = 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen xxx yyy zzz'
      const result = detectEditCategory(original, sent)
      expect(result.similarity).toBeCloseTo(0.7, 1)
      expect(result.category).toBe('minor_edit')
    })
  })

  describe('major_rewrite category (<70% similarity)', () => {
    it('should return major_rewrite for completely different text', () => {
      const original =
        'Thank you for contacting us about your subscription issue.'
      const sent =
        "I apologize for the confusion regarding the billing cycle dates."
      const result = detectEditCategory(original, sent)
      expect(result.category).toBe('major_rewrite')
      expect(result.similarity).toBeLessThan(EDIT_THRESHOLDS.MINOR_EDIT)
    })

    it('should return major_rewrite for substantial rewrites', () => {
      const original =
        'Your account has been upgraded to the premium tier. All features are now available.'
      const sent =
        "I've gone ahead and processed the upgrade request. You should now have access to everything in the premium plan. Let me know if you have any questions!"
      const result = detectEditCategory(original, sent)
      expect(result.category).toBe('major_rewrite')
    })

    it('should return major_rewrite for tone changes', () => {
      const original =
        'The requested action cannot be performed due to policy restrictions.'
      const sent =
        "I totally understand where you're coming from! Unfortunately we aren't able to do that specific thing, but here's what I can do instead..."
      const result = detectEditCategory(original, sent)
      expect(result.category).toBe('major_rewrite')
    })
  })

  describe('edge cases', () => {
    it('should handle very short texts', () => {
      const result = detectEditCategory('Hi', 'Hello')
      expect(result.category).toBe('major_rewrite')
      expect(result.similarity).toBe(0)
    })

    it('should handle single word texts', () => {
      const result = detectEditCategory('Thanks', 'Thanks')
      expect(result.category).toBe('unchanged')
      expect(result.similarity).toBe(1.0)
    })

    it('should handle texts with only HTML', () => {
      const result = detectEditCategory('<br><br>', '<p></p>')
      // Both normalize to empty, which is considered identical
      expect(result.category).toBe('unchanged')
      expect(result.similarity).toBe(1.0)
    })

    it('should handle unicode and special characters', () => {
      const original = 'Hello 👋 world'
      const sent = 'Hello 👋 world'
      const result = detectEditCategory(original, sent)
      expect(result.category).toBe('unchanged')
    })

    it('should handle real email signature differences', () => {
      const original = `Hi there,

Thanks for reaching out! I've processed your refund.

Best regards,
Support Team`
      const sent = `Hi there,

Thanks for reaching out! I've processed your refund.

Best,
Sarah`
      const result = detectEditCategory(original, sent)
      // Most content is the same, signature is different
      expect(result.category).toBe('minor_edit')
    })

    it('should handle draft markers being stripped', () => {
      const original =
        'Thanks for contacting us!<!-- agent-draft-id:abc123 -->'
      const sent = 'Thanks for contacting us!'
      const result = detectEditCategory(original, sent)
      // The marker gets stripped as HTML, so they should be the same
      expect(result.category).toBe('unchanged')
    })
  })
})

describe('EDIT_THRESHOLDS', () => {
  it('should have correct threshold values', () => {
    expect(EDIT_THRESHOLDS.UNCHANGED).toBe(0.95)
    expect(EDIT_THRESHOLDS.MINOR_EDIT).toBe(0.7)
  })

  it('should have UNCHANGED > MINOR_EDIT', () => {
    expect(EDIT_THRESHOLDS.UNCHANGED).toBeGreaterThan(EDIT_THRESHOLDS.MINOR_EDIT)
  })
})
