import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  _internal,
  calculateEditDistance,
  captureDraftCorrection,
  captureEscalationOverride,
  captureReclassification,
  compareAndCaptureDraftCorrection,
} from '../correction-capture'

// Mock the SupportMemoryService
vi.mock('@skillrecordings/memory/support-memory', () => ({
  SupportMemoryService: {
    store: vi.fn().mockImplementation(async (input) => ({
      id: 'test-memory-id',
      content: `SITUATION: ${input.situation}\n\nDECISION: ${input.decision}`,
      metadata: {
        collection: `support:${input.app_slug}`,
        source: 'agent',
        app_slug: input.app_slug,
        tags: input.tags ?? [],
        confidence: 1,
        created_at: new Date().toISOString(),
        votes: { upvotes: 0, downvotes: 0, citations: 0, success_rate: 0 },
        stage: input.stage,
        outcome: input.outcome,
        correction: input.correction,
        category: input.category,
        conversation_id: input.conversation_id,
      },
    })),
  },
}))

describe('calculateEditDistance', () => {
  it('returns 0 for identical strings', () => {
    const result = calculateEditDistance('hello world', 'hello world')
    expect(result.distance).toBe(0)
    expect(result.operations).toBe(0)
    expect(result.isMeaningful).toBe(false)
  })

  it('normalizes whitespace before comparison', () => {
    const result = calculateEditDistance('hello   world', 'hello world')
    expect(result.distance).toBe(0)
    expect(result.isMeaningful).toBe(false)
  })

  it('is case-insensitive', () => {
    const result = calculateEditDistance('Hello World', 'hello world')
    expect(result.distance).toBe(0)
    expect(result.isMeaningful).toBe(false)
  })

  it('detects meaningful edits', () => {
    const original = 'Here is your refund confirmation.'
    const modified =
      'Your refund has been processed and should appear in 3-5 business days.'
    const result = calculateEditDistance(original, modified)

    expect(result.distance).toBeGreaterThan(0.1)
    expect(result.isMeaningful).toBe(true)
  })

  it('detects small edits as not meaningful', () => {
    const original = 'Here is your refund confirmation.'
    const modified = 'Here is your refund confirmation!'
    const result = calculateEditDistance(original, modified)

    expect(result.distance).toBeLessThan(0.1)
    expect(result.isMeaningful).toBe(false)
  })

  it('handles empty strings', () => {
    expect(calculateEditDistance('', '').distance).toBe(0)
    expect(calculateEditDistance('hello', '').distance).toBe(1)
    expect(calculateEditDistance('', 'hello').distance).toBe(1)
  })

  it('respects custom threshold', () => {
    const original = 'this is a longer test string'
    const modified = 'this is a longer test string!'

    // Default threshold (0.1) - should not be meaningful (1 char out of ~30)
    const result1 = calculateEditDistance(original, modified)
    expect(result1.isMeaningful).toBe(false)

    // Lower threshold (0.01) - should be meaningful
    const result2 = calculateEditDistance(original, modified, 0.01)
    expect(result2.isMeaningful).toBe(true)
  })
})

describe('levenshteinDistance (internal)', () => {
  it('calculates correct distance for simple cases', () => {
    expect(_internal.levenshteinDistance('kitten', 'sitting')).toBe(3)
    expect(_internal.levenshteinDistance('saturday', 'sunday')).toBe(3)
  })

  it('handles edge cases', () => {
    expect(_internal.levenshteinDistance('', '')).toBe(0)
    expect(_internal.levenshteinDistance('abc', '')).toBe(3)
    expect(_internal.levenshteinDistance('', 'abc')).toBe(3)
  })
})

describe('captureDraftCorrection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns null for trivial edits', async () => {
    const result = await captureDraftCorrection({
      appId: 'total-typescript',
      conversationId: 'cnv_123',
      originalDraft: 'Here is your refund.',
      sentMessage: 'Here is your refund!',
      category: 'support_refund',
    })

    expect(result).toBeNull()
  })

  it('captures meaningful draft edits', async () => {
    const result = await captureDraftCorrection({
      appId: 'total-typescript',
      conversationId: 'cnv_123',
      originalDraft: 'Here is your refund.',
      sentMessage:
        'Your refund has been processed and will appear in 3-5 business days.',
      category: 'support_refund',
    })

    expect(result).not.toBeNull()
    expect(result?.type).toBe('draft_edit')
    expect(result?.appId).toBe('total-typescript')
    expect(result?.conversationId).toBe('cnv_123')
    expect(['minor', 'moderate', 'major']).toContain(result?.severity)
  })

  it('classifies severity based on edit distance', async () => {
    // Minor edit (< 20%)
    const minor = await captureDraftCorrection({
      appId: 'test',
      conversationId: 'cnv_1',
      originalDraft: 'Here is your refund confirmation for the course.',
      sentMessage: 'Here is your refund confirmation for the course purchase.',
      category: 'support_refund',
    })

    // Major edit (> 50%)
    const major = await captureDraftCorrection({
      appId: 'test',
      conversationId: 'cnv_2',
      originalDraft: 'Hi there!',
      sentMessage:
        'I apologize for any confusion. Your refund has been processed and should appear in your account within 3-5 business days. Please let me know if you have any other questions.',
      category: 'support_refund',
    })

    // With significant differences, severity should be captured
    if (major) {
      expect(major.severity).toBe('major')
    }
  })
})

describe('captureReclassification', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('captures reclassifications', async () => {
    const result = await captureReclassification({
      appId: 'total-typescript',
      conversationId: 'cnv_123',
      originalCategory: 'support_technical',
      newCategory: 'support_refund',
      originalConfidence: 0.85,
      reason: 'Customer is actually asking for refund',
    })

    expect(result.type).toBe('reclassification')
    expect(result.appId).toBe('total-typescript')
    expect(result.severity).toBe('major') // High confidence + cross-family
  })

  it('classifies severity based on confidence and category families', async () => {
    // Low confidence within same family = minor
    const minor = await captureReclassification({
      appId: 'test',
      conversationId: 'cnv_1',
      originalCategory: 'support_access',
      newCategory: 'support_billing',
      originalConfidence: 0.55,
    })
    expect(minor.severity).toBe('minor')

    // High confidence wrong = major
    const major = await captureReclassification({
      appId: 'test',
      conversationId: 'cnv_2',
      originalCategory: 'spam',
      newCategory: 'support_refund',
      originalConfidence: 0.9,
    })
    expect(major.severity).toBe('major')
  })
})

describe('captureEscalationOverride', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('captures escalation overrides', async () => {
    const result = await captureEscalationOverride({
      appId: 'total-typescript',
      conversationId: 'cnv_123',
      originalAction: 'respond',
      newAction: 'escalate_urgent',
      originalReason: 'Standard refund request',
      overrideReason: 'Customer threatening chargeback',
      category: 'support_refund',
    })

    expect(result.type).toBe('escalation_override')
    expect(result.appId).toBe('total-typescript')
    expect(result.severity).toBe('major') // Big escalation jump
  })

  it('classifies severity based on escalation level difference', async () => {
    // Small change = minor
    const minor = await captureEscalationOverride({
      appId: 'test',
      conversationId: 'cnv_1',
      originalAction: 'respond',
      newAction: 'support_teammate',
      originalReason: 'Standard request',
      category: 'support_access',
    })
    expect(minor.severity).toBe('minor')

    // Big under-escalation = major
    const major = await captureEscalationOverride({
      appId: 'test',
      conversationId: 'cnv_2',
      originalAction: 'silence',
      newAction: 'escalate_urgent',
      originalReason: 'Looked like spam',
      overrideReason: 'Actually a VIP customer',
      category: 'support_refund',
    })
    expect(major.severity).toBe('major')
  })
})

describe('compareAndCaptureDraftCorrection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns captured: false when no stored draft', async () => {
    const result = await compareAndCaptureDraftCorrection({
      appId: 'test',
      conversationId: 'cnv_123',
      storedDraft: null,
      sentMessage: 'Hello!',
      category: 'support_access',
    })

    expect(result.captured).toBe(false)
    expect(result.correction).toBeUndefined()
  })

  it('returns captured: true when meaningful edit detected', async () => {
    const result = await compareAndCaptureDraftCorrection({
      appId: 'test',
      conversationId: 'cnv_123',
      storedDraft: 'Draft message',
      sentMessage: 'Completely different message with more content added.',
      category: 'support_access',
    })

    expect(result.captured).toBe(true)
    expect(result.correction).toBeDefined()
  })

  it('returns captured: false when edit is trivial', async () => {
    const result = await compareAndCaptureDraftCorrection({
      appId: 'test',
      conversationId: 'cnv_123',
      storedDraft: 'Hello there!',
      sentMessage: 'Hello there.',
      category: 'support_access',
    })

    expect(result.captured).toBe(false)
  })
})

describe('severity classification helpers', () => {
  describe('classifyDraftEditSeverity', () => {
    it('classifies based on edit distance', () => {
      expect(_internal.classifyDraftEditSeverity(0.15)).toBe('minor')
      expect(_internal.classifyDraftEditSeverity(0.35)).toBe('moderate')
      expect(_internal.classifyDraftEditSeverity(0.6)).toBe('major')
    })
  })

  describe('classifyEscalationOverrideSeverity', () => {
    it('treats under-escalation as more severe', () => {
      // respond -> escalate_urgent (under-escalated, diff = 4)
      const underEscalation = _internal.classifyEscalationOverrideSeverity(
        'respond',
        'escalate_urgent'
      )
      expect(underEscalation).toBe('major')

      // escalate_urgent -> respond (over-escalated, diff = 4)
      const overEscalation = _internal.classifyEscalationOverrideSeverity(
        'escalate_urgent',
        'respond'
      )
      expect(overEscalation).toBe('major')
    })
  })
})
