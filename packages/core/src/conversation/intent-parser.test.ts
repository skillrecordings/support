import { describe, expect, it } from 'vitest'
import {
  type EditParams,
  type HoldParams,
  type IntentResult,
  describeIntent,
  isConfident,
  parseIntent,
} from './intent-parser'

describe('parseIntent', () => {
  describe('approve intent', () => {
    it.each([
      ['send it', 0.9],
      ['send', 0.9],
      ['just send', 0.9],
      ['Send', 0.9],
      ['SEND IT', 0.9],
    ])(
      'recognizes "%s" as approve with confidence >= %s',
      async (input, minConfidence) => {
        const result = await parseIntent(input)
        expect(result.type).toBe('approve')
        expect(result.confidence).toBeGreaterThanOrEqual(minConfidence)
      }
    )

    it.each([
      ['lgtm', 0.95],
      ['LGTM', 0.95],
      ['lgtm.', 0.95],
      ['looks good', 0.9],
      ['looks good to me', 0.9],
      ['Looks good to me.', 0.9],
    ])(
      'recognizes "%s" as approve with confidence >= %s',
      async (input, minConfidence) => {
        const result = await parseIntent(input)
        expect(result.type).toBe('approve')
        expect(result.confidence).toBeGreaterThanOrEqual(minConfidence)
      }
    )

    it.each([
      ['go ahead', 0.9],
      ['go ahead and send', 0.9],
      ['ship it', 0.9],
      ['ship', 0.9],
      ['approved', 0.95],
      ['approve', 0.95],
    ])(
      'recognizes "%s" as approve with confidence >= %s',
      async (input, minConfidence) => {
        const result = await parseIntent(input)
        expect(result.type).toBe('approve')
        expect(result.confidence).toBeGreaterThanOrEqual(minConfidence)
      }
    )

    it.each([
      ['yes, send', 0.9],
      ['yeah send it', 0.9],
      ['yep, ship it', 0.9],
      ['ok send', 0.9],
    ])('recognizes affirmative + action "%s" as approve', async (input) => {
      const result = await parseIntent(input)
      expect(result.type).toBe('approve')
      expect(result.confidence).toBeGreaterThanOrEqual(0.8)
    })

    it.each([['👍'], ['✅'], ['💯']])(
      'recognizes emoji "%s" as approve',
      async (input) => {
        const result = await parseIntent(input)
        expect(result.type).toBe('approve')
        expect(result.confidence).toBeGreaterThanOrEqual(0.8)
      }
    )

    it('recognizes simple "yes" with lower confidence', async () => {
      const result = await parseIntent('yes')
      expect(result.type).toBe('approve')
      expect(result.confidence).toBeLessThan(0.8) // lower because ambiguous
    })
  })

  describe('hold intent', () => {
    it.each([
      ['hold', undefined, undefined],
      ['hold on', undefined, undefined],
      ['wait', undefined, undefined],
    ])(
      'recognizes "%s" as hold without timing',
      async (input, until, duration) => {
        const result = await parseIntent(input)
        expect(result.type).toBe('hold')
        const params = result.parameters as HoldParams
        expect(params.until).toBe(until)
        expect(params.duration).toBe(duration)
      }
    )

    it.each([
      ['hold until Monday', 'Monday'],
      ['hold until tomorrow', 'tomorrow'],
      ['wait until next week', 'next week'],
      ['hold till Friday', 'Friday'],
    ])(
      'recognizes "%s" and extracts until=%s',
      async (input, expectedUntil) => {
        const result = await parseIntent(input)
        expect(result.type).toBe('hold')
        const params = result.parameters as HoldParams
        expect(params.until).toBe(expectedUntil)
      }
    )

    it.each([
      ['snooze 2h', '2h'],
      ['snooze for 2h', '2h'],
      ['snooze 30m', '30m'],
      ['snooze for 1d', '1d'],
      ['snooze 2 hours', '2h'],
      ['snooze for 30 minutes', '30m'],
      ['snooze 1 day', '1d'],
    ])(
      'recognizes "%s" and extracts duration=%s',
      async (input, expectedDuration) => {
        const result = await parseIntent(input)
        expect(result.type).toBe('hold')
        expect(result.confidence).toBeGreaterThanOrEqual(0.9)
        const params = result.parameters as HoldParams
        expect(params.duration).toBe(expectedDuration)
      }
    )

    it.each([
      ['delay until tomorrow', 'tomorrow'],
      ['delay', undefined],
    ])('recognizes delay command "%s"', async (input, expectedUntil) => {
      const result = await parseIntent(input)
      expect(result.type).toBe('hold')
      const params = result.parameters as HoldParams
      expect(params.until).toBe(expectedUntil)
    })

    it('recognizes "don\'t send yet" as hold', async () => {
      const result = await parseIntent("don't send yet")
      expect(result.type).toBe('hold')
      expect(result.confidence).toBeGreaterThanOrEqual(0.8)
    })

    it('recognizes "do not send" as hold', async () => {
      const result = await parseIntent('do not send')
      expect(result.type).toBe('hold')
    })

    it('handles hold for duration with timing', async () => {
      const result = await parseIntent('hold for 2h')
      expect(result.type).toBe('hold')
      const params = result.parameters as HoldParams
      expect(params.duration).toBe('2h')
    })
  })

  describe('edit intent', () => {
    describe('change X to Y pattern', () => {
      it.each([
        ['change hello to hi', 'hello', 'hi'],
        [
          'change "the product" to "our solution"',
          'the product',
          'our solution',
        ],
        ["change 'Monday' to 'Tuesday'", 'Monday', 'Tuesday'],
        ['Change foo to bar', 'foo', 'bar'],
      ])(
        'parses "%s" extracting target and replacement',
        async (input, target, replacement) => {
          const result = await parseIntent(input)
          expect(result.type).toBe('edit')
          expect(result.confidence).toBeGreaterThanOrEqual(0.9)
          const params = result.parameters as EditParams
          expect(params.target).toBe(target)
          expect(params.replacement).toBe(replacement)
        }
      )
    })

    describe('replace X with Y pattern', () => {
      it.each([
        ['replace hello with hi', 'hello', 'hi'],
        ['Replace the old text with new text', 'the old text', 'new text'],
      ])(
        'parses "%s" extracting target and replacement',
        async (input, target, replacement) => {
          const result = await parseIntent(input)
          expect(result.type).toBe('edit')
          const params = result.parameters as EditParams
          expect(params.target).toBe(target)
          expect(params.replacement).toBe(replacement)
        }
      )
    })

    describe('style adjustments', () => {
      it.each([
        'make it shorter',
        'make shorter',
        'make it longer',
        'make it friendlier',
        'make it more formal',
        'make it more casual',
        'make it simpler',
        'make it clearer',
        'make it concise',
      ])('recognizes style adjustment "%s"', async (input) => {
        const result = await parseIntent(input)
        expect(result.type).toBe('edit')
        expect(result.confidence).toBeGreaterThanOrEqual(0.85)
        const params = result.parameters as EditParams
        expect(params.instruction).toBe(input)
      })

      it.each([
        'make it more professional',
        'make more empathetic',
        'make it less verbose',
      ])('recognizes modifier "%s"', async (input) => {
        const result = await parseIntent(input)
        expect(result.type).toBe('edit')
        expect(result.confidence).toBeGreaterThanOrEqual(0.8)
      })
    })

    describe('action verbs', () => {
      it.each([
        ['shorten the response', 0.85],
        ['simplify this', 0.85],
        ['clarify the explanation', 0.85],
        ['rewrite the intro', 0.85],
        ['rephrase the last paragraph', 0.85],
      ])('recognizes action verb in "%s"', async (input, minConfidence) => {
        const result = await parseIntent(input)
        expect(result.type).toBe('edit')
        expect(result.confidence).toBeGreaterThanOrEqual(minConfidence)
      })
    })

    describe('add/remove patterns', () => {
      it.each([
        ['add a greeting', 0.8],
        ['add more details', 0.8],
        ['remove the last sentence', 0.85],
        ['delete the PS', 0.85],
        ['drop the signature', 0.85],
      ])('recognizes "%s" as edit', async (input, minConfidence) => {
        const result = await parseIntent(input)
        expect(result.type).toBe('edit')
        expect(result.confidence).toBeGreaterThanOrEqual(minConfidence)
      })
    })

    describe('polite requests', () => {
      it.each([
        'can you change the tone',
        'please update the greeting',
        'can you please fix the typo',
        'please modify the subject line',
      ])('recognizes polite request "%s"', async (input) => {
        const result = await parseIntent(input)
        expect(result.type).toBe('edit')
        expect(result.confidence).toBeGreaterThanOrEqual(0.75)
      })
    })

    it('handles generic edit command', async () => {
      const result = await parseIntent('edit: make it sound more professional')
      expect(result.type).toBe('edit')
      const params = result.parameters as EditParams
      expect(params.instruction).toBe('make it sound more professional')
    })
  })

  describe('unknown intent', () => {
    it.each([
      'hello there',
      'what time is it',
      "I'm not sure",
      'maybe',
      'hmm let me think',
      'thanks for asking',
    ])('returns unknown for ambiguous input "%s"', async (input) => {
      const result = await parseIntent(input)
      expect(result.type).toBe('unknown')
      expect(result.confidence).toBe(0)
      expect(result.parameters).toEqual({ type: 'unknown', raw: input })
    })

    it('preserves raw input in unknown result', async () => {
      const result = await parseIntent('  some random text  ')
      expect(result.type).toBe('unknown')
      expect(result.parameters).toEqual({
        type: 'unknown',
        raw: 'some random text',
      })
    })
  })

  describe('edge cases', () => {
    it('handles empty string', async () => {
      const result = await parseIntent('')
      expect(result.type).toBe('unknown')
    })

    it('handles whitespace-only input', async () => {
      const result = await parseIntent('   ')
      expect(result.type).toBe('unknown')
    })

    it('handles mixed case', async () => {
      const result = await parseIntent('SEND IT')
      expect(result.type).toBe('approve')
    })

    it('trims whitespace', async () => {
      const result = await parseIntent('  lgtm  ')
      expect(result.type).toBe('approve')
    })
  })
})

describe('isConfident', () => {
  it('returns true when confidence meets threshold', async () => {
    const result: IntentResult = {
      type: 'approve',
      confidence: 0.9,
      parameters: { type: 'approve' },
    }
    expect(isConfident(result)).toBe(true)
    expect(isConfident(result, 0.9)).toBe(true)
  })

  it('returns false when confidence below threshold', async () => {
    const result: IntentResult = {
      type: 'approve',
      confidence: 0.5,
      parameters: { type: 'approve' },
    }
    expect(isConfident(result)).toBe(false)
    expect(isConfident(result, 0.6)).toBe(false)
  })

  it('uses custom threshold', async () => {
    const result: IntentResult = {
      type: 'approve',
      confidence: 0.5,
      parameters: { type: 'approve' },
    }
    expect(isConfident(result, 0.5)).toBe(true)
    expect(isConfident(result, 0.4)).toBe(true)
  })
})

describe('describeIntent', () => {
  it('describes approve intent', () => {
    const result: IntentResult = {
      type: 'approve',
      confidence: 0.9,
      parameters: { type: 'approve' },
    }
    expect(describeIntent(result)).toBe('User wants to approve/send the draft')
  })

  it('describes hold intent with until', () => {
    const result: IntentResult = {
      type: 'hold',
      confidence: 0.9,
      parameters: { type: 'hold', until: 'Monday' },
    }
    expect(describeIntent(result)).toBe('User wants to hold until Monday')
  })

  it('describes hold intent with duration', () => {
    const result: IntentResult = {
      type: 'hold',
      confidence: 0.9,
      parameters: { type: 'hold', duration: '2h' },
    }
    expect(describeIntent(result)).toBe('User wants to hold for 2h')
  })

  it('describes hold intent without timing', () => {
    const result: IntentResult = {
      type: 'hold',
      confidence: 0.9,
      parameters: { type: 'hold' },
    }
    expect(describeIntent(result)).toBe('User wants to hold/delay')
  })

  it('describes edit intent with target and replacement', () => {
    const result: IntentResult = {
      type: 'edit',
      confidence: 0.9,
      parameters: {
        type: 'edit',
        instruction: 'change hello to hi',
        target: 'hello',
        replacement: 'hi',
      },
    }
    expect(describeIntent(result)).toBe('User wants to change "hello" to "hi"')
  })

  it('describes edit intent with just instruction', () => {
    const result: IntentResult = {
      type: 'edit',
      confidence: 0.9,
      parameters: { type: 'edit', instruction: 'make it shorter' },
    }
    expect(describeIntent(result)).toBe('User wants to edit: make it shorter')
  })

  it('describes unknown intent', () => {
    const result: IntentResult = {
      type: 'unknown',
      confidence: 0,
      parameters: { type: 'unknown', raw: 'gibberish' },
    }
    expect(describeIntent(result)).toBe('Intent could not be determined')
  })
})
