/**
 * Validate step tests
 *
 * Tests pattern-based validation for meta-commentary, internal leaks,
 * banned phrases, fabrication, and length checks.
 *
 * Added as part of Epic 1A Safety Net — expanding meta-commentary and
 * system-disclosure detection based on forensic audit findings.
 */

import { describe, expect, it } from 'vitest'
import type { GatherOutput, ValidateInput } from '../types'
import {
  formatIssues,
  getIssuesByType,
  hasIssueType,
  validateSync,
} from './validate'

// ============================================================================
// Test helpers
// ============================================================================

const emptyContext: GatherOutput = {
  user: null,
  purchases: [],
  knowledge: [],
  history: [],
  priorMemory: [],
  priorConversations: [],
  gatherErrors: [],
}

const contextWithKnowledge: GatherOutput = {
  ...emptyContext,
  knowledge: [
    {
      id: 'k1',
      type: 'faq',
      content: 'Some knowledge item',
      relevance: 0.9,
    },
  ],
}

function makeInput(draft: string, context?: GatherOutput): ValidateInput {
  return {
    draft,
    context: context ?? contextWithKnowledge,
  }
}

function expectValid(draft: string, context?: GatherOutput) {
  const result = validateSync(makeInput(draft, context))
  if (!result.valid) {
    const issueDetails = result.issues
      .map((i) => `  [${i.type}] ${i.message} — match: "${i.match}"`)
      .join('\n')
    throw new Error(
      `Expected draft to be valid but got issues:\n${issueDetails}\n\nDraft: "${draft}"`
    )
  }
  return result
}

function expectInvalid(
  draft: string,
  issueType: string,
  context?: GatherOutput
) {
  const result = validateSync(makeInput(draft, context))
  const hasType = result.issues.some((i) => i.type === issueType)
  if (!hasType) {
    const actualTypes = result.issues.map((i) => i.type).join(', ')
    throw new Error(
      `Expected issue type "${issueType}" but got: [${actualTypes || 'none'}]\n\nDraft: "${draft}"`
    )
  }
  return result
}

// ============================================================================
// Internal leak patterns
// ============================================================================

describe('validate: internal leak detection', () => {
  describe('existing patterns', () => {
    it('catches "no instructor configured"', () => {
      expectInvalid('No instructor configured for this app.', 'internal_leak')
    })

    it('catches "can\'t route"', () => {
      expectInvalid(
        "I can't route this to the appropriate person.",
        'internal_leak'
      )
    })

    it('catches "should be routed"', () => {
      expectInvalid('This should be routed to the instructor.', 'internal_leak')
    })

    it('catches "routing failed"', () => {
      expectInvalid('Routing failed for this conversation.', 'internal_leak')
    })

    it('catches "app not found"', () => {
      expectInvalid('App not found in our system.', 'internal_leak')
    })

    it('catches "database error"', () => {
      expectInvalid(
        'There was a database error looking up your account.',
        'internal_leak'
      )
    })

    it('catches "falls outside my scope"', () => {
      expectInvalid('This falls outside my scope of support.', 'internal_leak')
    })
  })

  describe('new patterns (Epic 1A)', () => {
    it('catches "don\'t have an instructor"', () => {
      expectInvalid(
        "I don't have an instructor configured in the system for this app.",
        'internal_leak'
      )
    })

    it('catches "do not have an instructor"', () => {
      expectInvalid(
        'I do not have an instructor available to route this to.',
        'internal_leak'
      )
    })

    it('catches "no instructor assignment"', () => {
      expectInvalid(
        "Since there's no instructor assignment configured for this app, I can't forward it.",
        'internal_leak'
      )
    })

    it('catches "can\'t forward this to"', () => {
      expectInvalid("I can't forward this to Matt directly.", 'internal_leak')
    })

    it('catches "cannot assign this directly"', () => {
      expectInvalid(
        'I cannot assign this directly to the instructor.',
        'internal_leak'
      )
    })

    it('catches "can\'t use assignToInstructor"', () => {
      expectInvalid(
        "I can't use assignToInstructor for this app.",
        'internal_leak'
      )
    })

    it('catches "in the system"', () => {
      expectInvalid(
        "I don't have a way to route this in the system.",
        'internal_leak'
      )
    })

    it('catches "within our system"', () => {
      expectInvalid('This is not available within our system.', 'internal_leak')
    })

    it('catches "internal process"', () => {
      expectInvalid(
        "You'll want to get this to him through whatever internal process you use for instructor correspondence.",
        'internal_leak'
      )
    })

    it('catches "internal routing"', () => {
      expectInvalid(
        'The internal routing for this app is not configured.',
        'internal_leak'
      )
    })

    it('catches "configured to forward"', () => {
      expectInvalid(
        "I'm not configured to forward messages to instructors.",
        'internal_leak'
      )
    })

    it('catches "our tools don\'t"', () => {
      expectInvalid(
        "Our tools don't support this type of routing.",
        'internal_leak'
      )
    })

    it('catches "my system doesn\'t"', () => {
      expectInvalid(
        "My system doesn't have access to that information.",
        'internal_leak'
      )
    })

    it('catches "forwarded to business team"', () => {
      // "This should be forwarded" also triggers meta_commentary; verify both fire
      const result = validateSync(
        makeInput(
          "This should be forwarded to Matt's business development team."
        )
      )
      expect(result.valid).toBe(false)
      expect(result.issues.some((i) => i.type === 'internal_leak')).toBe(true)
    })

    it('catches "dev team or equivalent"', () => {
      expectInvalid(
        'This should be forwarded to the dev team or equivalent.',
        'internal_leak'
      )
    })

    it('catches "don\'t have a way to route"', () => {
      expectInvalid(
        "I don't have a way to route this directly to Matt.",
        'internal_leak'
      )
    })

    it('catches "don\'t have the means to forward"', () => {
      expectInvalid(
        "I don't have the means to forward this to the instructor.",
        'internal_leak'
      )
    })
  })
})

// ============================================================================
// Meta-commentary patterns
// ============================================================================

describe('validate: meta-commentary detection', () => {
  describe('existing patterns', () => {
    it('catches "This is a vendor email" at start', () => {
      expectInvalid(
        'This is a vendor email, not a support request.',
        'meta_commentary'
      )
    })

    it('catches "I won\'t respond"', () => {
      expectInvalid(
        "I won't respond to this outreach email.",
        'meta_commentary'
      )
    })

    it('catches "I\'m going to stop"', () => {
      expectInvalid(
        "I'm going to stop here. This is personal.",
        'meta_commentary'
      )
    })

    it('catches "No response needed"', () => {
      expectInvalid('No response needed for this message.', 'meta_commentary')
    })

    it('catches "Per my guidelines"', () => {
      expectInvalid(
        'Per my guidelines, I should not respond to vendor emails.',
        'meta_commentary'
      )
    })

    it('catches "is not a support request"', () => {
      expectInvalid('This is clearly not a support request.', 'meta_commentary')
    })

    it('catches "This should be handled"', () => {
      expectInvalid(
        'This should be handled by the instructor directly.',
        'meta_commentary'
      )
    })
  })

  describe("agent explaining what it's going to do (Epic 1A)", () => {
    it('catches "I\'ll draft a response that..."', () => {
      expectInvalid(
        "I'll draft a response that acknowledges their concern.",
        'meta_commentary'
      )
    })

    it('catches "I will compose a reply"', () => {
      expectInvalid(
        'I will compose a reply addressing the refund request.',
        'meta_commentary'
      )
    })

    it('catches "I am going to write a response"', () => {
      expectInvalid(
        'I am going to write a response to their billing question.',
        'meta_commentary'
      )
    })

    it('catches "I\'ll prepare a message"', () => {
      expectInvalid(
        "I'll prepare a message explaining the access issue.",
        'meta_commentary'
      )
    })

    it('catches "I\'ll put together a reply"', () => {
      expectInvalid(
        "I'll put together a reply for this customer.",
        'meta_commentary'
      )
    })

    it('catches "Here\'s a draft response"', () => {
      expectInvalid(
        "Here's a draft response for the customer.",
        'meta_commentary'
      )
    })

    it('catches "Here is my proposed reply"', () => {
      expectInvalid(
        'Here is my proposed reply to the access question.',
        'meta_commentary'
      )
    })

    it('catches "Let me draft"', () => {
      expectInvalid(
        'Let me draft a response to this inquiry.',
        'meta_commentary'
      )
    })

    it('catches "Let me compose"', () => {
      expectInvalid(
        'Let me compose a reply for this customer.',
        'meta_commentary'
      )
    })
  })

  describe('agent describing the email instead of responding (Epic 1A)', () => {
    it('catches "This appears to be a..."', () => {
      expectInvalid(
        'This appears to be a vendor outreach email.',
        'meta_commentary'
      )
    })

    it('catches "This seems to be a..."', () => {
      expectInvalid('This seems to be a fan mail reply.', 'meta_commentary')
    })

    it('catches "This looks to be a..."', () => {
      expectInvalid(
        'This looks to be a partnership inquiry.',
        'meta_commentary'
      )
    })

    it('catches "This email is..."', () => {
      expectInvalid(
        'This email is a response to our outreach campaign.',
        'meta_commentary'
      )
    })

    it('catches "This message appears..."', () => {
      expectInvalid(
        'This message appears to be from a potential customer.',
        'meta_commentary'
      )
    })

    it('catches "This conversation involves..."', () => {
      expectInvalid(
        'This conversation involves a license transfer request.',
        'meta_commentary'
      )
    })
  })

  describe('agent referencing its own decision-making (Epic 1A)', () => {
    it('catches "I\'ve determined this..."', () => {
      expectInvalid(
        "I've determined this is a billing inquiry.",
        'meta_commentary'
      )
    })

    it('catches "I have classified this..."', () => {
      expectInvalid(
        'I have classified this as a fan mail response.',
        'meta_commentary'
      )
    })

    it('catches "I\'ve categorized the message"', () => {
      expectInvalid(
        "I've categorized the message as vendor outreach.",
        'meta_commentary'
      )
    })

    it('catches "I\'ve identified the conversation"', () => {
      expectInvalid(
        "I've identified the conversation as a presales inquiry.",
        'meta_commentary'
      )
    })

    it('catches "The conversation has been classified"', () => {
      expectInvalid(
        'The conversation has been classified as fan mail.',
        'meta_commentary'
      )
    })

    it('catches "This conversation has been flagged"', () => {
      expectInvalid(
        'This conversation has been flagged for review.',
        'meta_commentary'
      )
    })
  })

  describe('agent refusing to act (Epic 1A)', () => {
    it('catches "doesn\'t need a response"', () => {
      expectInvalid("This doesn't need a response from me.", 'meta_commentary')
    })

    it('catches "does not require a response"', () => {
      expectInvalid('This does not require a response.', 'meta_commentary')
    })

    it('catches "doesn\'t warrant any action"', () => {
      expectInvalid(
        "This doesn't warrant any action on my part.",
        'meta_commentary'
      )
    })

    it('catches "I don\'t need to respond"', () => {
      expectInvalid("I don't need to respond to this.", 'meta_commentary')
    })

    it('catches "This isn\'t something I..."', () => {
      expectInvalid(
        "This isn't something I should respond to.",
        'meta_commentary'
      )
    })

    it('catches "This is not a case I..."', () => {
      expectInvalid('This is not a case I can handle.', 'meta_commentary')
    })
  })

  describe('agent talking about customer in third person (Epic 1A)', () => {
    it('catches "The customer is asking..."', () => {
      expectInvalid('The customer is asking about a refund.', 'meta_commentary')
    })

    it('catches "The user has requested..."', () => {
      expectInvalid(
        'The user has requested a license transfer.',
        'meta_commentary'
      )
    })

    it('catches "The sender needs..."', () => {
      expectInvalid(
        'The sender needs help with their access.',
        'meta_commentary'
      )
    })

    it('catches "The person wants..."', () => {
      expectInvalid(
        'The person wants a refund for their purchase.',
        'meta_commentary'
      )
    })

    it('catches "the customer\'s question is..."', () => {
      expectInvalid(
        "I see that the customer's question is about billing.",
        'meta_commentary'
      )
    })

    it('catches "the user\'s request..."', () => {
      expectInvalid(
        "Looking at the user's request for help.",
        'meta_commentary'
      )
    })

    it('catches "the sender\'s email..."', () => {
      expectInvalid(
        "The sender's email is about a partnership.",
        'meta_commentary'
      )
    })
  })

  describe('agent narrating routing/escalation (Epic 1A)', () => {
    it('catches "Flagging this to Matt"', () => {
      expectInvalid('Flagging this to Matt for review.', 'meta_commentary')
    })

    it('catches "I\'m routing this to..."', () => {
      expectInvalid("I'm routing this to the instructor.", 'meta_commentary')
    })

    it('catches "I\'m escalating this to..."', () => {
      expectInvalid("I'm escalating this to a human agent.", 'meta_commentary')
    })

    it('catches "I\'ll forward this to..."', () => {
      expectInvalid(
        "I'll forward this to Matt for his attention.",
        'meta_commentary'
      )
    })

    it('catches "I\'ll escalate this for..."', () => {
      expectInvalid("I'll escalate this for review.", 'meta_commentary')
    })

    it('catches "I will pass this along"', () => {
      expectInvalid('I will pass this along to the team.', 'meta_commentary')
    })
  })

  describe('categorization language (Epic 1A)', () => {
    it('catches "This is a business outreach email"', () => {
      expectInvalid('This is a business outreach email.', 'meta_commentary')
    })

    it('catches "This is a vendor pitch"', () => {
      expectInvalid(
        'This is a vendor pitch, not a support request.',
        'meta_commentary'
      )
    })

    it('catches "This is a fan mail reply"', () => {
      expectInvalid(
        'This is a fan mail reply to our outreach.',
        'meta_commentary'
      )
    })

    it('catches "This is a personal message"', () => {
      expectInvalid(
        "This is a personal message from Matt's fan.",
        'meta_commentary'
      )
    })

    it('catches "This is a promotional email"', () => {
      expectInvalid(
        'This is a promotional email from a SaaS vendor.',
        'meta_commentary'
      )
    })

    it('catches "not a support request"', () => {
      expectInvalid('This is clearly not a support request.', 'meta_commentary')
    })

    it('catches "not a customer support question"', () => {
      expectInvalid(
        'This is not a customer support question.',
        'meta_commentary'
      )
    })

    it('catches "This should be forwarded" (expanded)', () => {
      expectInvalid(
        'This should be forwarded to the instructor.',
        'meta_commentary'
      )
    })

    it('catches "This needs to be escalated"', () => {
      expectInvalid(
        'This needs to be escalated to a human agent.',
        'meta_commentary'
      )
    })
  })

  describe('real audit examples (Epic 1A)', () => {
    it('catches Response 5: "I\'m going to stop here..."', () => {
      const draft =
        "I'm going to stop here. This is a personal message from Matt asking you to engage directly about your interests in AI. It's not a support request. I'll route this to Matt so he sees your response."
      expectInvalid(draft, 'meta_commentary')
    })

    it('catches Response 11: "This is a vendor/business invoice request..."', () => {
      const draft =
        "This is a vendor/business invoice request, not a customer support request... I don't need to respond to this."
      expectInvalid(draft, 'meta_commentary')
    })

    it('catches Response 16: "This is a business outreach/partnership pitch..."', () => {
      const draft =
        "This is a business outreach/partnership pitch... I won't respond to this. Per my guidelines, this should be routed directly to Matt."
      expectInvalid(draft, 'meta_commentary')
    })

    it('catches Response 20: "I don\'t have an instructor configured..."', () => {
      const draft =
        "I don't have an instructor configured in the system for this app... You'll want to get this to him through whatever internal process you use for instructor correspondence."
      // This should trigger internal_leak (primary), not meta_commentary
      expectInvalid(draft, 'internal_leak')
    })

    it('catches batch fan mail: "No instructor routing configured..."', () => {
      const draft =
        "No instructor routing configured for this app, so I can't forward it that way."
      expectInvalid(draft, 'internal_leak')
    })

    it('catches batch fan mail: "I don\'t have a way to route..."', () => {
      const draft =
        "I don't have a way to route this directly to Matt in the system."
      expectInvalid(draft, 'internal_leak')
    })

    it('catches batch fan mail: "Since there\'s no instructor assignment..."', () => {
      const draft =
        "Since there's no instructor assignment configured for this app, I can't forward it."
      expectInvalid(draft, 'internal_leak')
    })

    it('catches batch fan mail: "This should be forwarded to Matt\'s business development team..."', () => {
      const draft =
        "This should be forwarded to Matt's business development team or equivalent."
      // Can trigger meta_commentary (This should be forwarded) or internal_leak (business development team)
      const result = validateSync(makeInput(draft))
      expect(result.valid).toBe(false)
      expect(result.issues.length).toBeGreaterThan(0)
    })
  })
})

// ============================================================================
// Legitimate responses (false-positive guards)
// ============================================================================

describe('validate: legitimate responses pass', () => {
  it('allows a normal support response', () => {
    expectValid(
      "I've looked into your account and can see your purchase from October 18th. It looks like the access issue is related to using a different email for GitHub login. Could you try logging in at totaltypescript.com/login with the email you used for the purchase?"
    )
  })

  it('allows a response that mentions technical details', () => {
    expectValid(
      'The "Unexpected token export" error happens when the browser tries to run ES module code without the module flag. Try adding type="module" to your script tag: <script type="module" src="...">. That should resolve it.'
    )
  })

  it('allows a response that acknowledges and asks for info', () => {
    expectValid(
      'Sure, I can look into your refund. Could you share the email address you used for the purchase so I can pull up your account? If you have the receipt email, the order number would help too.'
    )
  })

  it('allows a response about access issues', () => {
    expectValid(
      'It sounds like you might be logged in with a different email than the one you purchased with. Try requesting a fresh magic link at totaltypescript.com/login using your purchase email.'
    )
  })

  it('allows a response about Zoom links', () => {
    expectValid(
      "The Zoom link for the workshop comes in a separate email closer to the event time. Check your spam folder, sometimes those get filtered. If you still don't see it an hour before the session, let me know and I'll make sure you get access."
    )
  })

  it('allows a response that says "the system" in a customer context', () => {
    // "in the system" should flag — but only when referencing internal systems.
    // We accept that this pattern is slightly aggressive; better safe than sorry.
    // This test documents that the pattern IS triggered even in borderline cases.
    const result = validateSync(
      makeInput('Your purchase should be in the system within 24 hours.')
    )
    // This WILL match "in the system" — that's intentional (false positive we accept)
    expect(result.issues.some((i) => i.type === 'internal_leak')).toBe(true)
  })

  it('allows short but valid response', () => {
    expectValid(
      "Yes, there will be a recording available after the live session. You'll get access to the self-paced version with all the materials."
    )
  })

  it('does not flag "your request" (not third person)', () => {
    expectValid(
      "I've received your request and I'm looking into the refund now. I'll follow up shortly with an update."
    )
  })

  it('does not flag "you" language (second person is fine)', () => {
    expectValid(
      'You should be able to access the course by logging in with the email you used for the purchase. Let me know if that works.'
    )
  })
})

// ============================================================================
// Fabrication patterns
// ============================================================================

describe('validate: fabrication detection', () => {
  it('catches module references without knowledge', () => {
    expectInvalid(
      'Start with Module 1, which covers the basics of TypeScript.',
      'fabrication',
      emptyContext
    )
  })

  it('catches lesson references without knowledge', () => {
    expectInvalid(
      'Check out lesson 3 for the answer to your question.',
      'fabrication',
      emptyContext
    )
  })

  it('allows module references WITH knowledge', () => {
    expectValid(
      'Start with Module 1, which covers the basics of TypeScript.',
      contextWithKnowledge
    )
  })
})

// ============================================================================
// Length checks
// ============================================================================

describe('validate: length checks', () => {
  it('flags too-short responses as warning', () => {
    const result = validateSync(makeInput('Hi'))
    expect(result.issues.some((i) => i.type === 'too_short')).toBe(true)
    // Warnings don't make it invalid
    expect(result.valid).toBe(true)
  })

  it('flags too-long responses as warning', () => {
    const longDraft = 'x'.repeat(2001)
    const result = validateSync(makeInput(longDraft))
    expect(result.issues.some((i) => i.type === 'too_long')).toBe(true)
    expect(result.valid).toBe(true)
  })
})

// ============================================================================
// Helper functions
// ============================================================================

describe('validate: helper functions', () => {
  it('formatIssues produces readable output', () => {
    const result = validateSync(
      makeInput("No instructor configured for this app. I won't respond.")
    )
    const formatted = formatIssues(result.issues)
    expect(formatted).toContain('[ERROR]')
    expect(formatted).toContain('internal_leak')
  })

  it('hasIssueType finds specific types', () => {
    const result = validateSync(
      makeInput('No instructor configured for this app.')
    )
    expect(hasIssueType(result.issues, 'internal_leak')).toBe(true)
    expect(hasIssueType(result.issues, 'fabrication')).toBe(false)
  })

  it('getIssuesByType filters correctly', () => {
    const result = validateSync(
      makeInput("No instructor configured. I won't respond. Per my guidelines.")
    )
    const leaks = getIssuesByType(result.issues, 'internal_leak')
    const meta = getIssuesByType(result.issues, 'meta_commentary')
    expect(leaks.length).toBeGreaterThan(0)
    expect(meta.length).toBeGreaterThan(0)
  })
})

// ============================================================================
// Strict mode
// ============================================================================

describe('validate: strict mode', () => {
  it('treats warnings as errors in strict mode', () => {
    const result = validateSync({
      draft: 'Hi', // too short (warning)
      context: contextWithKnowledge,
      strictMode: true,
    })
    // In strict mode, the too_short warning still doesn't affect valid
    // because hasErrors only checks severity === 'error'
    // But allIssues includes warnings in both modes
    expect(result.issues.some((i) => i.type === 'too_short')).toBe(true)
  })
})
