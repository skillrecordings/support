/**
 * Comment formatters unit tests
 *
 * Tests the comment formatting functions for escalation, approval, and audit scenarios.
 */

import { describe, expect, it } from 'vitest'
import type { GatherOutput } from '../types'
import {
  type ApprovalContext,
  type AuditContext,
  type EscalationContext,
  formatApprovalComment,
  formatAuditComment,
  formatEscalationComment,
  formatMinimalComment,
  formatSupportComment,
} from './comment'

// ============================================================================
// Test Data
// ============================================================================

const mockGatherOutput: GatherOutput = {
  user: { id: 'user-1', email: '[EMAIL]', name: 'Test User' },
  purchases: [
    {
      id: 'purchase-1',
      productId: 'prod-1',
      productName: 'Total TypeScript',
      purchasedAt: '2024-01-01',
      status: 'active',
      amount: 9900,
    },
    {
      id: 'purchase-2',
      productId: 'prod-2',
      productName: 'Testing JavaScript',
      purchasedAt: '2024-02-01',
      status: 'refunded',
      amount: 4900,
    },
  ],
  knowledge: [
    {
      id: 'kb-1',
      type: 'faq',
      content: 'To reset your password, click the forgot password link...',
      relevance: 0.9,
      source: 'help-center',
    },
  ],
  history: [],
  priorMemory: [
    {
      id: 'mem-1',
      content: 'Customer previously had access issues in December',
      tags: ['access', 'resolved'],
      relevance: 0.8,
    },
  ],
  priorConversations: [],
  gatherErrors: [],
}

const mockEscalationContext: EscalationContext = {
  type: 'urgent',
  reason: 'Legal threat detected in message',
  customer: {
    email: '[EMAIL]',
    name: 'Angry Customer',
    id: 'user-123',
  },
  purchases: [
    {
      productName: 'Epic React',
      productId: 'epic-react-v2',
      purchasedAt: '2024-03-15',
      status: 'active',
      amount: 59900,
    },
  ],
  classification: {
    category: 'support_refund',
    confidence: 0.95,
    reasoning: 'Customer mentions lawyer and demands immediate refund',
  },
  agentFindings: [
    'Purchase is outside 30-day refund window',
    'Customer has accessed 80% of course content',
    'No prior support tickets from this customer',
  ],
  links: {
    admin: 'https://admin.example.com/users/user-123',
    magicLogin: 'https://example.com/magic-link/abc123',
    frontConversation: 'https://app.frontapp.com/open/cnv_xyz',
  },
}

const mockApprovalContext: ApprovalContext = {
  draft:
    "Hi there!\n\nI'd be happy to help you with your access issue. I've sent a magic link to your email.\n\nBest,\nSupport",
  reviewReason: 'Low confidence classification',
  confidence: 0.65,
  category: 'support_access',
  customerEmail: '[EMAIL]',
  actionLinks: {
    approve: 'https://support.example.com/approve/action-123',
    edit: 'https://support.example.com/edit/action-123',
  },
}

const mockAuditContext: AuditContext = {
  action: 'auto_sent',
  category: 'support_access',
  confidence: 0.92,
  timestamp: new Date('2024-06-15T10:30:00Z'),
  messageId: 'msg_abc123',
}

// ============================================================================
// formatSupportComment Tests
// ============================================================================

describe('formatSupportComment', () => {
  it('should include customer email and name', () => {
    const result = formatSupportComment(mockGatherOutput)

    expect(result).toContain('[EMAIL]')
    expect(result).toContain('Test User')
  })

  it('should include purchases with amounts', () => {
    const result = formatSupportComment(mockGatherOutput)

    expect(result).toContain('Total TypeScript')
    expect(result).toContain('$99.00')
    expect(result).toContain('Testing JavaScript')
    expect(result).toContain('(refunded)')
  })

  it('should include knowledge base hits', () => {
    const result = formatSupportComment(mockGatherOutput)

    expect(result).toContain('Relevant KB')
    expect(result).toContain('reset your password')
  })

  it('should include prior memory', () => {
    const result = formatSupportComment(mockGatherOutput)

    expect(result).toContain('Agent memory')
    expect(result).toContain('access issues in December')
  })

  it('should show no purchases message when empty', () => {
    const contextWithoutPurchases: GatherOutput = {
      ...mockGatherOutput,
      purchases: [],
    }
    const result = formatSupportComment(contextWithoutPurchases)

    expect(result).toContain('None found for this email')
  })

  it('should include gather errors when present', () => {
    const contextWithErrors: GatherOutput = {
      ...mockGatherOutput,
      gatherErrors: [{ step: 'knowledge', error: 'Qdrant connection failed' }],
    }
    const result = formatSupportComment(contextWithErrors)

    expect(result).toContain('Some data unavailable')
    expect(result).toContain('knowledge')
    expect(result).toContain('Qdrant connection failed')
  })
})

describe('formatMinimalComment', () => {
  it('should include customer email and purchases summary', () => {
    const result = formatMinimalComment(mockGatherOutput)

    expect(result).toContain('[EMAIL]')
    expect(result).toContain('Total TypeScript')
    expect(result).toContain('Testing JavaScript')
  })

  it('should handle missing user', () => {
    const contextWithoutUser: GatherOutput = {
      ...mockGatherOutput,
      user: null,
    }
    const result = formatMinimalComment(contextWithoutUser)

    expect(result).toContain('Could not look up customer info')
  })
})

// ============================================================================
// formatEscalationComment Tests
// ============================================================================

describe('formatEscalationComment', () => {
  it('should include header with correct emoji for urgent', () => {
    const result = formatEscalationComment(mockEscalationContext)

    expect(result).toContain('🚨')
    expect(result).toContain('URGENT')
    expect(result).toContain('Agent Escalation')
  })

  it('should use correct emoji for instructor escalation', () => {
    const instructorContext: EscalationContext = {
      ...mockEscalationContext,
      type: 'instructor',
    }
    const result = formatEscalationComment(instructorContext)

    expect(result).toContain('👨‍🏫')
    expect(result).toContain('Instructor')
  })

  it('should use correct emoji for teammate_support escalation', () => {
    const teammateContext: EscalationContext = {
      ...mockEscalationContext,
      type: 'teammate_support',
    }
    const result = formatEscalationComment(teammateContext)

    expect(result).toContain('🤝')
    expect(result).toContain('Teammate Support')
  })

  it('should use correct emoji for voc escalation', () => {
    const vocContext: EscalationContext = {
      ...mockEscalationContext,
      type: 'voc',
    }
    const result = formatEscalationComment(vocContext)

    expect(result).toContain('📣')
    expect(result).toContain('Voice of Customer')
  })

  it('should include escalation reason', () => {
    const result = formatEscalationComment(mockEscalationContext)

    expect(result).toContain('Legal threat detected in message')
  })

  it('should include classification details', () => {
    const result = formatEscalationComment(mockEscalationContext)

    expect(result).toContain('support_refund')
    expect(result).toContain('95%')
    expect(result).toContain('lawyer and demands immediate refund')
  })

  it('should include customer info section', () => {
    const result = formatEscalationComment(mockEscalationContext)

    expect(result).toContain('Customer Info')
    expect(result).toContain('[EMAIL]')
    expect(result).toContain('Angry Customer')
    expect(result).toContain('user-123')
  })

  it('should include purchases with amounts', () => {
    const result = formatEscalationComment(mockEscalationContext)

    expect(result).toContain('Epic React')
    expect(result).toContain('$599.00')
  })

  it('should handle no purchases', () => {
    const contextWithoutPurchases: EscalationContext = {
      ...mockEscalationContext,
      purchases: [],
    }
    const result = formatEscalationComment(contextWithoutPurchases)

    expect(result).toContain('No purchases found for this email')
  })

  it('should include agent findings', () => {
    const result = formatEscalationComment(mockEscalationContext)

    expect(result).toContain('What Agent Found/Tried')
    expect(result).toContain('outside 30-day refund window')
    expect(result).toContain('accessed 80% of course content')
    expect(result).toContain('No prior support tickets')
  })

  it('should include quick links section', () => {
    const result = formatEscalationComment(mockEscalationContext)

    expect(result).toContain('Quick Links')
    expect(result).toContain('[Admin Profile]')
    expect(result).toContain('https://admin.example.com/users/user-123')
    expect(result).toContain('[Magic Login]')
    expect(result).toContain('[Front Conversation]')
  })

  it('should render links as clickable markdown', () => {
    const result = formatEscalationComment(mockEscalationContext)

    // Check markdown link format
    expect(result).toMatch(/\[Admin Profile\]\(https:\/\/.*\)/)
    expect(result).toMatch(/\[Magic Login\]\(https:\/\/.*\)/)
  })

  it('should handle minimal context (no optional fields)', () => {
    const minimalContext: EscalationContext = {
      type: 'normal',
      reason: 'Needs human review',
      customer: { email: '[EMAIL]' },
    }
    const result = formatEscalationComment(minimalContext)

    expect(result).toContain('⚠️')
    expect(result).toContain('[EMAIL]')
    expect(result).toContain('Needs human review')
    expect(result).not.toContain('Quick Links')
  })
})

// ============================================================================
// formatApprovalComment Tests
// ============================================================================

describe('formatApprovalComment', () => {
  it('should include header', () => {
    const result = formatApprovalComment(mockApprovalContext)

    expect(result).toContain('🔍')
    expect(result).toContain('Draft Pending Review')
  })

  it('should include review reason', () => {
    const result = formatApprovalComment(mockApprovalContext)

    expect(result).toContain('Low confidence classification')
  })

  it('should show confidence with yellow indicator for medium confidence', () => {
    const result = formatApprovalComment(mockApprovalContext)

    expect(result).toContain('🟡')
    expect(result).toContain('65%')
  })

  it('should show green indicator for high confidence', () => {
    const highConfidenceContext: ApprovalContext = {
      ...mockApprovalContext,
      confidence: 0.85,
    }
    const result = formatApprovalComment(highConfidenceContext)

    expect(result).toContain('🟢')
    expect(result).toContain('85%')
  })

  it('should show red indicator for low confidence', () => {
    const lowConfidenceContext: ApprovalContext = {
      ...mockApprovalContext,
      confidence: 0.45,
    }
    const result = formatApprovalComment(lowConfidenceContext)

    expect(result).toContain('🔴')
    expect(result).toContain('45%')
  })

  it('should include category', () => {
    const result = formatApprovalComment(mockApprovalContext)

    expect(result).toContain('support_access')
  })

  it('should include customer email', () => {
    const result = formatApprovalComment(mockApprovalContext)

    expect(result).toContain('[EMAIL]')
  })

  it('should include draft preview as blockquote', () => {
    const result = formatApprovalComment(mockApprovalContext)

    expect(result).toContain('Draft Preview')
    expect(result).toContain('> Hi there!')
    expect(result).toContain("> I'd be happy to help")
  })

  it('should preserve multiline draft formatting', () => {
    const result = formatApprovalComment(mockApprovalContext)

    // Each line should be quoted
    expect(result).toMatch(/> .*magic link/)
    expect(result).toMatch(/> Best,/)
  })

  it('should include action links', () => {
    const result = formatApprovalComment(mockApprovalContext)

    expect(result).toContain('Actions')
    expect(result).toContain('[✅ Approve & Send]')
    expect(result).toContain('[✏️ Edit Draft]')
  })

  it('should handle missing action links', () => {
    const contextWithoutLinks: ApprovalContext = {
      ...mockApprovalContext,
      actionLinks: undefined,
    }
    const result = formatApprovalComment(contextWithoutLinks)

    expect(result).not.toContain('Actions')
    expect(result).not.toContain('Approve & Send')
  })

  it('should handle missing optional fields', () => {
    const minimalContext: ApprovalContext = {
      draft: 'Simple draft',
      reviewReason: 'Needs review',
      confidence: 0.7,
    }
    const result = formatApprovalComment(minimalContext)

    expect(result).toContain('Simple draft')
    expect(result).not.toContain('Category')
    expect(result).not.toContain('Customer')
  })
})

// ============================================================================
// formatAuditComment Tests
// ============================================================================

describe('formatAuditComment', () => {
  it('should include action with correct emoji for auto_sent', () => {
    const result = formatAuditComment(mockAuditContext)

    expect(result).toContain('✅')
    expect(result).toContain('Auto-sent')
  })

  it('should use correct emoji for draft_created', () => {
    const draftContext: AuditContext = {
      ...mockAuditContext,
      action: 'draft_created',
    }
    const result = formatAuditComment(draftContext)

    expect(result).toContain('📝')
    expect(result).toContain('Draft Created')
  })

  it('should use correct emoji for silenced', () => {
    const silencedContext: AuditContext = {
      ...mockAuditContext,
      action: 'silenced',
    }
    const result = formatAuditComment(silencedContext)

    expect(result).toContain('🔇')
    expect(result).toContain('Silenced')
  })

  it('should use correct emoji for escalated', () => {
    const escalatedContext: AuditContext = {
      ...mockAuditContext,
      action: 'escalated',
    }
    const result = formatAuditComment(escalatedContext)

    expect(result).toContain('⚠️')
    expect(result).toContain('Escalated')
  })

  it('should format custom action labels', () => {
    const customContext: AuditContext = {
      ...mockAuditContext,
      action: 'custom_action_name',
    }
    const result = formatAuditComment(customContext)

    expect(result).toContain('🤖')
    expect(result).toContain('Custom Action Name')
  })

  it('should include category and confidence', () => {
    const result = formatAuditComment(mockAuditContext)

    expect(result).toContain('support_access')
    expect(result).toContain('92%')
  })

  it('should include ISO timestamp', () => {
    const result = formatAuditComment(mockAuditContext)

    expect(result).toContain('2024-06-15T10:30:00.000Z')
  })

  it('should use current timestamp if not provided', () => {
    const contextWithoutTimestamp: AuditContext = {
      action: 'auto_sent',
      category: 'support_access',
      confidence: 0.9,
    }
    const result = formatAuditComment(contextWithoutTimestamp)

    // Should have a timestamp in ISO format
    expect(result).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
  })

  it('should include message ID when provided', () => {
    const result = formatAuditComment(mockAuditContext)

    expect(result).toContain('msg_abc123')
  })

  it('should omit message ID when not provided', () => {
    const contextWithoutMessageId: AuditContext = {
      ...mockAuditContext,
      messageId: undefined,
    }
    const result = formatAuditComment(contextWithoutMessageId)

    expect(result).not.toContain('Message ID')
  })

  it('should be compact (single line per field)', () => {
    const result = formatAuditComment(mockAuditContext)
    const lines = result.split('\n')

    // Should be concise - header, category/confidence, timestamp, messageId
    expect(lines.length).toBeLessThanOrEqual(4)
  })
})

// ============================================================================
// Markdown Rendering Tests (Front compatibility)
// ============================================================================

describe('Markdown rendering for Front', () => {
  it('should use **bold** for headers', () => {
    const result = formatEscalationComment(mockEscalationContext)

    expect(result).toMatch(/\*\*.*\*\*/)
  })

  it('should use proper markdown links', () => {
    const result = formatEscalationComment(mockEscalationContext)

    // [text](url) format
    expect(result).toMatch(/\[.*\]\(https:\/\/.*\)/)
  })

  it('should use --- for section dividers', () => {
    const result = formatEscalationComment(mockEscalationContext)

    expect(result).toContain('---')
  })

  it('should use > for blockquotes in approval comments', () => {
    const result = formatApprovalComment(mockApprovalContext)

    expect(result).toMatch(/^> /m)
  })

  it('should use - for bullet lists', () => {
    const result = formatEscalationComment(mockEscalationContext)

    expect(result).toMatch(/^- /m)
  })
})
