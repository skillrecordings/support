import { generateObject } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { retrieveSkills } from '../../../skill-retrieval'
import type {
  GatherOutput,
  MessageCategory,
  ValidateInput,
  ValidationIssue,
} from '../../types'
import { calculateConfidenceScore, validate } from '../validate'
import * as validateModule from '../validate'

vi.mock('ai', () => ({
  generateObject: vi.fn(),
}))

vi.mock('../../../skill-retrieval', () => ({
  retrieveSkills: vi.fn(),
}))

const retrieveSkillsMock = retrieveSkills as unknown as ReturnType<typeof vi.fn>
const generateObjectMock = generateObject as unknown as ReturnType<typeof vi.fn>

const emptyContext: GatherOutput = {
  user: null,
  purchases: [],
  knowledge: [],
  history: [],
  priorMemory: [],
  priorConversations: [],
  gatherErrors: [],
}

function makeInput(
  draft: string,
  customerMessage: { subject: string; body: string },
  originalMessage?: string
): ValidateInput {
  return {
    draft,
    context: emptyContext,
    customerMessage,
    originalMessage,
  }
}

describe('four-tier response system', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns draft action by default', async () => {
    retrieveSkillsMock.mockResolvedValue([])
    const getCategoryStatsMock = vi
      .spyOn(validateModule, 'getCategoryStats')
      .mockResolvedValue({ sentUnchangedRate: 0, volume: 0 })

    const result = await validate(
      makeInput(
        'Thanks for reaching out. Here is what I found.',
        { subject: 'Question', body: 'Need help.' },
        'Need help.'
      ),
      {
        skipMemoryQuery: true,
        skipRelevanceCheck: true,
      }
    )

    expect(result.action).toBe('draft')
    if (result.action !== 'draft') {
      throw new Error(`Expected draft action, got ${result.action}`)
    }
    expect(result.draft).toBe('Thanks for reaching out. Here is what I found.')
    expect(getCategoryStatsMock).toHaveBeenCalled()
  })

  it('escalates team-license category always', async () => {
    retrieveSkillsMock.mockResolvedValue([])
    vi.spyOn(validateModule, 'getCategoryStats').mockResolvedValue({
      sentUnchangedRate: 1,
      volume: 999,
    })

    const result = await validate(
      makeInput(
        'We can help with your team license request.',
        { subject: 'Team', body: 'Need a team license.' },
        'Need a team license.'
      ),
      {
        category: 'support_team-license' as MessageCategory,
        skipMemoryQuery: true,
        skipRelevanceCheck: true,
      }
    )

    expect(result.action).toBe('escalate')
    if (result.action !== 'escalate') {
      throw new Error(`Expected escalate action, got ${result.action}`)
    }
    expect(result.urgency).toBe('normal')
  })

  it('calculates gradient score correctly', () => {
    const issues: ValidationIssue[] = [
      {
        type: 'banned_phrase',
        severity: 'error',
        message: 'Bad phrase',
      },
      {
        type: 'too_short',
        severity: 'warning',
        message: 'Short response',
      },
      {
        type: 'relevance',
        severity: 'info',
        message: 'Minor relevance signal',
      },
    ]

    expect(calculateConfidenceScore(issues)).toBeCloseTo(0.58, 5)
  })

  it('auto-send only when category has earned it', async () => {
    retrieveSkillsMock.mockResolvedValue([])
    vi.spyOn(validateModule, 'getCategoryStats').mockResolvedValue({
      sentUnchangedRate: 0.99,
      volume: 120,
    })

    const result = await validate(
      makeInput(
        'Your refund request is ready for review.',
        { subject: 'Refund', body: 'Please refund.' },
        'Please refund.'
      ),
      {
        category: 'support_refund',
        skipMemoryQuery: true,
        skipRelevanceCheck: true,
      }
    )

    expect(result.action).toBe('auto-send')
    if (result.action !== 'auto-send') {
      throw new Error(`Expected auto-send action, got ${result.action}`)
    }
    expect(result.confidence).toBe(1)
  })
})

describe('ground truth comparison', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('retrieves skills for customer message', async () => {
    retrieveSkillsMock.mockResolvedValue([])

    await validate(
      makeInput(
        'We can help with your refund.',
        { subject: 'Refund', body: 'Need a refund please.' },
        'Need a refund please.'
      ),
      {
        skipMemoryQuery: true,
        skipRelevanceCheck: true,
      }
    )

    expect(retrieveSkillsMock).toHaveBeenCalledWith('Need a refund please.', {
      topK: 3,
    })
  })

  it('passes when draft matches skill content', async () => {
    retrieveSkillsMock.mockResolvedValue([
      {
        skill_id: 'refund-policy',
        name: 'Refund Policy',
        description: 'We offer a 30-day refund policy.',
        path: 'skills/refund-policy.md',
        markdown: 'Refunds are available within 30 days of purchase.',
        indexed_at: '2024-01-01T00:00:00.000Z',
        score: 0.92,
      },
    ])

    const result = await validate(
      makeInput(
        'You can request a refund within 30 days of purchase.',
        { subject: 'Refund', body: 'What is the refund window?' },
        'What is the refund window?'
      ),
      {
        skipMemoryQuery: true,
        skipRelevanceCheck: true,
      }
    )

    expect(
      result.issues.some((issue) => issue.type === 'ground_truth_mismatch')
    ).toBe(false)
    expect(result.valid).toBe(true)
  })

  it('flags when draft contradicts skill content', async () => {
    retrieveSkillsMock.mockResolvedValue([
      {
        skill_id: 'refund-policy',
        name: 'Refund Policy',
        description: 'We offer a 60-day refund policy.',
        path: 'skills/refund-policy.md',
        markdown: 'Refunds are available within 60 days of purchase.',
        indexed_at: '2024-01-01T00:00:00.000Z',
        score: 0.92,
      },
    ])

    const result = await validate(
      makeInput(
        'We offer a 30-day refund window.',
        { subject: 'Refund', body: 'Can I get a refund?' },
        'Can I get a refund?'
      ),
      {
        skipMemoryQuery: true,
        skipRelevanceCheck: true,
      }
    )

    expect(
      result.issues.some((issue) => issue.type === 'ground_truth_mismatch')
    ).toBe(true)
    expect(result.valid).toBe(false)
  })
})

describe('relevance check', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns numeric score not N/A', async () => {
    retrieveSkillsMock.mockResolvedValue([])
    generateObjectMock.mockResolvedValue({
      object: {
        relevant: true,
        score: 0.72,
        reasoning: 'Directly addresses the refund request.',
      },
    } as Awaited<ReturnType<typeof generateObject>>)

    const result = await validate(
      makeInput('Here is the refund policy.', {
        subject: 'Refund',
        body: 'How do I request a refund?',
      }),
      {
        skipMemoryQuery: true,
      }
    )

    expect(typeof result.relevance).toBe('number')
    expect(result.relevance).toBeGreaterThanOrEqual(0)
    expect(result.relevance).toBeLessThanOrEqual(1)
  })
})

describe('fabrication detection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('passes when price matches skill content', async () => {
    retrieveSkillsMock.mockResolvedValue([
      {
        skill_id: 'pricing',
        name: 'Pricing',
        description: 'The course costs $99.',
        path: 'skills/pricing.md',
        markdown: 'Current price is $99 for lifetime access.',
        indexed_at: '2024-01-01T00:00:00.000Z',
        score: 0.88,
      },
    ])

    const result = await validate(
      makeInput(
        'The course is $99 and includes lifetime access.',
        { subject: 'Pricing', body: 'How much is it?' },
        'How much is it?'
      ),
      {
        skipMemoryQuery: true,
        skipRelevanceCheck: true,
      }
    )

    expect(result.issues.some((issue) => issue.type === 'fabrication')).toBe(
      false
    )
    expect(result.valid).toBe(true)
  })

  it('flags price claim not in skills', async () => {
    retrieveSkillsMock.mockResolvedValue([
      {
        skill_id: 'pricing',
        name: 'Pricing',
        description: 'The course costs $99.',
        path: 'skills/pricing.md',
        markdown: 'Current price is $99 for lifetime access.',
        indexed_at: '2024-01-01T00:00:00.000Z',
        score: 0.88,
      },
    ])

    const result = await validate(
      makeInput(
        'The course is $149 right now.',
        { subject: 'Pricing', body: 'How much is it?' },
        'How much is it?'
      ),
      {
        skipMemoryQuery: true,
        skipRelevanceCheck: true,
      }
    )

    const fabrication = result.issues.find(
      (issue) => issue.type === 'fabrication'
    )
    expect(fabrication?.severity).toBe('error')
    expect(result.valid).toBe(false)
  })

  it('flags timeline without source', async () => {
    retrieveSkillsMock.mockResolvedValue([
      {
        skill_id: 'support',
        name: 'Support SLA',
        description: 'We respond in business hours.',
        path: 'skills/support.md',
        markdown: 'Support is available Monday through Friday.',
        indexed_at: '2024-01-01T00:00:00.000Z',
        score: 0.75,
      },
    ])

    const result = await validate(
      makeInput(
        'We will get back to you within 24 hours.',
        { subject: 'Support', body: 'When will I hear back?' },
        'When will I hear back?'
      ),
      {
        skipMemoryQuery: true,
        skipRelevanceCheck: true,
      }
    )

    const fabrication = result.issues.find(
      (issue) => issue.type === 'fabrication'
    )
    expect(fabrication?.severity).toBe('warning')
  })

  it('does not flag quoted customer text', async () => {
    retrieveSkillsMock.mockResolvedValue([
      {
        skill_id: 'pricing',
        name: 'Pricing',
        description: 'The course costs $99.',
        path: 'skills/pricing.md',
        markdown: 'Current price is $99 for lifetime access.',
        indexed_at: '2024-01-01T00:00:00.000Z',
        score: 0.88,
      },
    ])

    const result = await validate(
      makeInput(
        'Thanks for the details.\n> "I paid $50 last time."\nWe can take a look.',
        { subject: 'Pricing', body: 'I paid $50 last time.' },
        'I paid $50 last time.'
      ),
      {
        skipMemoryQuery: true,
        skipRelevanceCheck: true,
      }
    )

    expect(result.issues.some((issue) => issue.type === 'fabrication')).toBe(
      false
    )
  })
})
