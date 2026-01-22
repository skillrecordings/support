/**
 * Evalite-based evaluation for support agent response quality
 *
 * Evaluates responses against known bad patterns:
 * 1. Internal state leakage (config errors, routing info)
 * 2. Meta-commentary (explaining instead of doing)
 * 3. Banned phrases (corporate speak)
 * 4. Product fabrication (inventing course content)
 * 5. Response usefulness (does it actually help?)
 *
 * Run: bunx evalite watch
 */

import { Levenshtein } from 'autoevals'
import { evalite } from 'evalite'

// ============================================================================
// Custom Scorers
// ============================================================================

/**
 * Detects internal state leakage in responses
 * - Configuration errors exposed to customers
 * - Routing/forwarding explanations
 * - System capability limitations
 */
const InternalStateLeakage = ({
  output,
}: {
  output: string
  expected?: string
  input?: string
}) => {
  const leakPatterns = [
    /no instructor (configured|routing|assigned|set up)/i,
    /can't route this/i,
    /unable to route/i,
    /no (instructor|channel|inbox) (is )?configured/i,
    /system (doesn't|does not|cannot|can't)/i,
    /not configured for this app/i,
    /routing (not )?(set up|configured)/i,
    /tool (failed|error|returned)/i,
    /API (error|failed|token)/i,
    /forwarding (to|this)/i,
    /I'll note that this/i,
    /You'll want to reach out through/i,
    /should be routed/i,
    /should go to/i,
    /falls outside/i,
  ]

  const foundLeaks: string[] = []
  for (const pattern of leakPatterns) {
    const match = output.match(pattern)
    if (match) {
      foundLeaks.push(match[0])
    }
  }

  return {
    name: 'internal_state_leakage',
    score: foundLeaks.length === 0 ? 1 : 0,
    metadata: {
      foundLeaks,
      leakCount: foundLeaks.length,
    },
  }
}

/**
 * Detects meta-commentary instead of actual responses
 * - "This is clearly a..." explanations
 * - "I won't respond because..." justifications
 * - Internal routing decisions exposed
 */
const MetaCommentary = ({
  output,
}: {
  output: string
  expected?: string
  input?: string
}) => {
  const metaPatterns = [
    /^This (is|appears to be|seems|looks like) (a |an )?(clearly )?/i,
    /I (won't|will not|shouldn't|should not) (respond|draft|reply)/i,
    /I don't need to respond/i,
    /this (should|needs to) (go to|be forwarded|be routed)/i,
    /per my guidelines/i,
    /outside (the scope|my scope|customer support)/i,
    /not a (support request|customer service issue)/i,
    /is clearly (not|meant|personal|business)/i,
    /This (falls|is) outside/i,
  ]

  const foundMeta: string[] = []
  for (const pattern of metaPatterns) {
    const match = output.match(pattern)
    if (match) {
      foundMeta.push(match[0])
    }
  }

  return {
    name: 'meta_commentary',
    score: foundMeta.length === 0 ? 1 : 0,
    metadata: {
      foundMeta,
      metaCount: foundMeta.length,
    },
  }
}

/**
 * Detects banned corporate phrases
 * - Fake enthusiasm
 * - Hedging language
 * - AI-speak patterns
 */
const BannedPhrases = ({
  output,
}: {
  output: string
  expected?: string
  input?: string
}) => {
  const bannedPatterns = [
    /^Great!/i,
    /I'd recommend/i,
    /I would recommend/i,
    /I'd suggest/i,
    /I would suggest/i,
    /Is there a specific area you're curious about/i,
    /Would you like help with/i,
    /Let me know if you have any other questions/i,
    /I hope this helps/i,
    /Happy to help/i,
    /I understand/i,
    /I hear you/i,
    /I apologize for any inconvenience/i,
    /Thanks (so much )?for (reaching out|sharing)/i,
    /What a wonderful message/i,
    /I really appreciate/i,
    /—/, // em dash
  ]

  const foundBanned: string[] = []
  for (const pattern of bannedPatterns) {
    const match = output.match(pattern)
    if (match) {
      foundBanned.push(match[0])
    }
  }

  return {
    name: 'banned_phrases',
    score: foundBanned.length === 0 ? 1 : 0,
    metadata: {
      foundBanned,
      bannedCount: foundBanned.length,
    },
  }
}

/**
 * Detects product content fabrication
 * - Made-up course modules/sections
 * - Invented features
 * - Generic advice dressed up as specific
 */
const ProductFabrication = ({
  output,
}: {
  output: string
  expected?: string
  input?: string
}) => {
  const fabricationPatterns = [
    /start with the (fundamentals|basics) section/i,
    /covers core concepts like/i,
    /the (course|module|section) (covers|teaches|includes)/i,
    /you('ll| will) learn (about )?(\w+, )+/i,
    /Start with the basics.*learn how/i,
    /fundamentals.*It covers/i,
  ]

  const foundFabrication: string[] = []
  for (const pattern of fabricationPatterns) {
    const match = output.match(pattern)
    if (match) {
      foundFabrication.push(match[0])
    }
  }

  return {
    name: 'product_fabrication',
    score: foundFabrication.length === 0 ? 1 : 0,
    metadata: {
      foundFabrication,
      fabricationCount: foundFabrication.length,
    },
  }
}

/**
 * Checks if response is actually helpful vs deflecting
 */
const Helpfulness = ({
  output,
}: {
  output: string
  expected?: string
  input?: string
}) => {
  const deflectionPatterns = [
    /I don't have (the ability|access|information)/i,
    /reach out (directly |through )/i,
    /contact.*directly/i,
    /you('ll| will) (need|have|want) to/i,
    /someone (else|on the team) (will|can|should)/i,
    /manually forward/i,
    /internal process/i,
  ]

  const helpfulPatterns = [
    /Login link:/i,
    /your (purchase|account|order)/i,
    /I'?ve (sent|processed|updated)/i,
    /refund/i,
    /transfer/i,
    /\b(here'?s|here is)\b/i,
  ]

  let deflections = 0
  for (const pattern of deflectionPatterns) {
    if (pattern.test(output)) deflections++
  }

  let helpful = 0
  for (const pattern of helpfulPatterns) {
    if (pattern.test(output)) helpful++
  }

  // Score based on ratio of helpful to deflecting
  const total = deflections + helpful
  const score = total === 0 ? 0.5 : helpful / total

  return {
    name: 'helpfulness',
    score,
    metadata: {
      deflections,
      helpfulIndicators: helpful,
    },
  }
}

// ============================================================================
// Test Dataset - Real examples from production
// Exported from /tmp/responses.json (37 real agent responses)
// ============================================================================

const testData = [
  // ====== BAD: Internal state leakage ======
  {
    input: 'Personal correspondence to Matt about partnership opportunity',
    output:
      "No instructor routing configured for this app, so I can't forward it that way. But wanted to flag that this seems like it's meant as personal correspondence rather than a support request.",
    expected: '', // Should not respond or remain silent
    label: 'internal_state_leak',
  },
  {
    input: 'Partnership inquiry from Leonard Yu',
    output:
      "Looks like there's no instructor routing configured for this app. Given that this is a partnership pitch directed at Matt personally rather than a support issue, it should go to his personal inbox or business contact rather than through the support channel. Leonard Yu should reach out directly through Mat's public contact channels if this is still pending.",
    expected: '',
    label: 'internal_state_leak',
  },
  {
    input: 'Response to Matt email about AI interests',
    output:
      "Looks like there's no instructor routing set up for this app. I won't draft a response here since this is clearly meant as personal correspondence for Matt rather than a support request. Someone on the team will need to see this directly.",
    expected: '',
    label: 'internal_state_leak',
  },
  {
    input: 'Personal reply to Matt about AI and Effect',
    output:
      "Looks like there's no instructor assignment set up for this app. But this is clearly a personal message from Urban responding to Matt's direct outreach about AI and Effect. This should get to Matt directly rather than going through standard support.",
    expected: '',
    label: 'internal_state_leak',
  },
  {
    input: 'Business development inquiry about sponsorships',
    output:
      "Since there's no instructor assignment configured for this app, I'll note that this is a business development inquiry that should be routed to whoever handles partnerships and sponsorships at the company level. This is outside the scope of product support.",
    expected: '',
    label: 'internal_state_leak',
  },
  {
    input: 'Personal message meant for Matt',
    output:
      "I don't have an instructor configured in the system for this app, so I can't route this directly. But this is clearly a personal message meant for Matt in response to his outreach about AI interests. You'll want to get this to him through whatever internal process you use for instructor correspondence.",
    expected: '',
    label: 'internal_state_leak',
  },
  {
    input: 'Business inquiry from Tasos about AI adoption',
    output:
      "I don't have a way to route this directly to Matt in the system, but this is clearly personal correspondence that should go to him directly rather than support.\n\nCan you forward this conversation to Matt? Tasos is sharing thoughtful feedback about AI adoption and how it connects to developer productivity on his team. This is the kind of thing he reads personally.",
    expected: '',
    label: 'internal_state_leak',
  },
  {
    input: 'Business sponsorship opportunity inquiry',
    output:
      "I can't route this directly to Matt through our system, but this is a business inquiry that needs his personal attention, not support team handling.\n\nYou'll want to reach out through his personal channels or social media to get a direct response on the sponsorship opportunity. The support inbox isn't the right place for partnership discussions.",
    expected: '',
    label: 'internal_state_leak',
  },

  // ====== BAD: Meta-commentary ======
  {
    input: 'Business partnership pitch from Leonardo',
    output:
      "This is a business outreach/partnership pitch directed at Matt (the instructor), not a customer support request. It's not spam—it's a legitimate professional inquiry to the creator.\n\nI won't respond to this. Per my guidelines, this should be routed directly to Matt for personal correspondence, but since I don't have a conversation ID from the system, I can't use assignToInstructor.\n\nNo action needed—this message will be handled through normal instructor routing channels.",
    expected: '',
    label: 'meta_commentary',
  },
  {
    input: 'Test/casual message from Joel',
    output:
      "This message is clearly not a customer support request — it's a casual/joking message without any actual issue to resolve. Per my guidelines, I should not draft a response to this.\n\nIf Joel has an actual support question or issue related to Total TypeScript, I'm ready to help when he reaches out.",
    expected: '',
    label: 'meta_commentary',
  },
  {
    input: 'Marketing email response from Thorr',
    output:
      "This is a customer response to a marketing email from Matt Pocock at Total TypeScript. Thorr is sharing genuine interest in the products and providing positive feedback about how Matt's work has influenced their project.\n\nThis isn't a support request, so I won't draft a response. This is a community/relationship-building message that should be handled by the Total TypeScript team directly, not through the support system.\n\nHowever, since this came through support channels, I can note: Thorr appears to be an engaged community member building on Total TypeScript's ideas and would likely be a good fit for deeper community engagement or partnership discussions. This should probably be routed to the business development or community team rather than support.",
    expected: '',
    label: 'meta_commentary',
  },
  {
    input: 'Personal conversation with Andrew',
    output:
      "I appreciate you reaching out, Andrew, but I need to let you know this appears to be a personal conversation with Matt rather than a support request.\n\nSince this isn't a customer service issue (no purchase problem, access issue, or product question), there's nothing I can help with here. This looks like it should stay between you and Matt directly.\n\nIf you do run into any issues accessing Total TypeScript courses or have questions about the material, just shoot me a message and I'll get you sorted.",
    expected: '',
    label: 'meta_commentary',
  },
  {
    input: 'B2B vendor invoice request',
    output:
      "This is a vendor/business invoice request, not a customer support request for the ai-hero product. This appears to be a B2B billing inquiry from a company's finance team requesting an invoice for a purchase order.\n\nI don't need to respond to this. This falls outside customer product support and should be routed to the appropriate billing/accounts department through your normal vendor management channels.",
    expected: '',
    label: 'meta_commentary',
  },
  {
    input: 'Automated Ahrefs Site Audit notification',
    output:
      "This is an automated notification from Ahrefs about a Site Audit crawl result for the Vercel Academy project. This is not a customer support request, so I won't draft a response.\n\nThe email is a system notification showing:\n- New crawl completed (130 URLs analyzed)\n- Health Score: 98 (+6 improvement)\n- Issues summary (3 errors, 130 warnings, 19 notices)\n- Various audit findings and recommendations\n\nNo action is needed from support.",
    expected: '',
    label: 'meta_commentary',
  },
  {
    input: 'Vendor/partnership outreach from Aha agency',
    output:
      "This is a vendor/partnership outreach email from Aha (a creator agency) to a content creator — not a customer support request for a technical education product.\n\nPer the guidelines, I won't be drafting a response to this message, as it's not from an actual customer seeking support for one of our products.",
    expected: '',
    label: 'meta_commentary',
  },
  {
    input: 'Marketing email from SeaVerse.AI',
    output:
      "This is a marketing/outreach email from SeaVerse.AI's team inviting developers to explore their platform. This is not a customer support request from someone with an existing issue.\n\nPer my guidelines, I should not draft a response to vendor/promotional emails that aren't actual customer support inquiries.\n\nNo action needed.",
    expected: '',
    label: 'meta_commentary',
  },

  // ====== BAD: Banned phrases ======
  {
    input: 'How do I start learning TypeScript?',
    output:
      "Great! If you're just starting out with TypeScript, I'd recommend beginning with the fundamentals:\n\n**Start with the basics** - Learn how TypeScript differs from JavaScript, type annotations, interfaces, and basic types. Most learners find it helpful to work through exercises that show you how types prevent bugs.\n\n**Practice incrementally** - Don't try to learn everything at once. Focus on types first, then move into more advanced concepts like generics, utility types, and advanced patterns once you're comfortable with the foundation.\n\nIs there a specific area you're curious about, or would you like help navigating the Total TypeScript resources available?",
    expected:
      'What specifically are you trying to build? Once I know that, I can point you to the right place to start.',
    label: 'banned_phrases',
  },
  {
    input: 'Course feedback from Dan about documentation',
    output:
      "Thanks Dan, really glad you got through the course so quickly. Your point about the frontend/backend setup makes sense - that `useChat` endpoint behavior could definitely be documented more explicitly upfront so people don't have to dig for it. That's solid feedback.\n\nAppreciate you taking the time to share this.",
    expected: 'Solid feedback. Matt will see this.',
    label: 'banned_phrases',
  },
  {
    input: 'Discount inquiry from Aminata',
    output:
      "Hi Aminata,\n\nThanks for reaching out. I don't have the ability to authorize discounts on pricing, but I'd recommend reaching out directly through the product website or checking if there are any current promotions running. Depending on timing, there may be opportunities available.\n\nFeel free to follow up if you have other questions.\n\nRegards",
    expected:
      "I can't authorize discounts. Check the website for current promotions.",
    label: 'banned_phrases',
  },

  // ====== BAD: Product fabrication ======
  {
    input: 'Where should I start in AI Hero?',
    output:
      "The knowledge base isn't returning results, but here's what I'd suggest: Start with the fundamentals section in AI Hero. It covers core concepts like how AI models work, prompt engineering basics, and common use cases. Work through one module at a time rather than trying to absorb everything at once.\n\nWhat specific part of AI are you most interested in - the theory side, practical applications, or something else?",
    expected:
      "What specifically are you trying to learn? I don't have the course structure available, but I can help once I know what you're after.",
    label: 'fabrication',
  },

  // ====== BAD: Unhelpful deflections ======
  {
    input: 'Does the site support light mode?',
    output:
      "I don't have documentation on that feature. What I can do is escalate this to someone who can give you a definitive answer about light mode support.\n\nAre you currently experiencing an issue with the display, or just checking if it's available before purchasing?",
    expected:
      "I don't have that information. What specifically are you trying to do with the display?",
    label: 'deflection',
  },
  {
    input: 'Personal reply to Matt from Chris about AI',
    output:
      "Looks like I can't route this directly through the system, but Matt should see this - it came through as a reply to his email outreach and Chris is responding thoughtfully about his interests in AI and implementation challenges.",
    expected: '',
    label: 'deflection',
  },
  {
    input: 'Reply about AI interests from follower',
    output:
      "Since this is a direct response to Matt's personal email asking what you want to learn about AI, he'll want to see this. I'd recommend replying directly to him at [EMAIL] so he gets your message directly rather than through support channels.",
    expected: '',
    label: 'deflection',
  },

  // ====== GOOD: Direct, helpful responses ======
  {
    input: "Can't log in with magic link",
    output:
      "What's the URL you're trying to access? If you're clicking an old magic link, those expire after 24h.\n\nTry requesting a fresh login link here: https://www.totaltypescript.com/login\n\nEnter [EMAIL] and it should send you a new link that works.",
    expected:
      'Magic links expire after 24h. Request a fresh one: [link]. Still stuck?',
    label: 'good_response',
  },
  {
    input: 'Purchase transfer issue',
    output:
      "I don't see a transfer request in our system. Did you try to transfer it yourself through the site, or did you just start using the [EMAIL] email?\n\nIf you already purchased with [EMAIL], I can transfer it to [EMAIL] for you. Just confirm that's what you need and I'll process it.",
    expected:
      'Confirm which email you want the course on and I can transfer it.',
    label: 'good_response',
  },
  {
    input: 'Course still on old email',
    output:
      "The purchase is still attached to [EMAIL]. It wasn't transferred to [EMAIL], which is why you're seeing the purchase prompt there.\n\nCan you confirm which email you want the course on? Once you confirm, I can transfer it over.",
    expected: 'Confirm the target email and I can transfer it now.',
    label: 'good_response',
  },
  {
    input: 'Feedback on learning journey',
    output:
      'Matt will see this directly. He loves hearing how folks are using the material.',
    expected: 'Matt will see this directly.',
    label: 'good_response',
  },
  {
    input: 'Module system error with exports',
    output:
      'This is a module system issue, not a version problem. Your compiled JavaScript has `export` statements, but browsers need a module-aware script tag to understand them.\n\nIn your HTML file, change:\n```html\n<script src="example.js"></script>\n```\n\nTo:\n```html\n<script type="module" src="example.js"></script>\n```\n\nThe `type="module"` tells the browser to treat the file as an ES module, which supports import/export syntax.\n\nIf that doesn\'t match what the lesson expects, the alternative is changing your TypeScript compiler settings to output a different module format (like CommonJS or a bundled file), but adding `type="module"` to the script tag is the typical fix here.',
    expected:
      'Add `type="module"` to your script tag. That tells the browser to handle ES modules.',
    label: 'good_response',
  },
  {
    input: 'Struggling with generics',
    output:
      "Generics are legitimately one of the harder concepts in TypeScript, so you're not alone there. They click once you start using them in real code, but the mental model takes time.\n\nWhat specifically is tripping you up? Are you stuck on:\n- Basic syntax like `<T>`?\n- Understanding constraints (`extends`)?\n- Using generics with functions vs. types?\n- Something else?\n\nOnce I know where you're hitting the wall, I can point you in the right direction.",
    expected:
      "What specifically is blocking you? Syntax, constraints, or something else? I'll point you to the right place once I know.",
    label: 'good_response',
  },
  {
    input: 'Refund request with missing account details',
    output:
      "I'm running into a technical issue pulling up your account. Can you provide:\n\n1. The purchase date or approximate timeframe\n2. The purchase/order ID if you have it\n3. The amount or product name\n\nOnce I have those details, I can process the refund for you.",
    expected:
      'Need: purchase date, order ID, or product name. Then I can process the refund.',
    label: 'good_response',
  },

  // ====== MIXED: Has issues but also attempts to help ======
  {
    input: 'Joel frustrated - TypeScript is hard, AI is taking jobs',
    output:
      "Hey Joel,\n\nI hear the frustration—TypeScript can feel overwhelming at first, but you've got this. The good news is you've got Total TypeScript, which is specifically designed to take you from confused to confident.\n\nHere's what I'd suggest:\n\n**Start small**: Don't try to learn everything at once. Pick one concept (types, generics, syntax) and nail it before moving on. The course is structured to build progressively.\n\n**You're building valuable skills**: TypeScript is in *high* demand right now and growing. Learning it now positions you well for what's coming next in your career.\n\n**What specifically is stuck?** Is it understanding types? Generics? The syntax? Tell me what's throwing you off and I can point you to the exact lessons that'll make it click.\n\nYou've already invested in the course—let's make sure you get real value from it.\n\nWhat do you want to tackle first?",
    expected:
      "What specifically is blocking you - types, generics, syntax? I'll point you to the right place.",
    label: 'mixed_banned_phrases_but_helpful',
  },
  {
    input: 'Joel asks what part of TypeScript is hard',
    output:
      "Alright, what specific part of TypeScript has you stuck? Are you dealing with:\n\n- Type annotations and basic types?\n- Interfaces and generics?\n- Something else entirely?\n\nGive me a bit more detail on where you're getting tripped up and I can point you in the right direction. And don't worry—AI isn't stealing jobs from people willing to learn. You've got this! 💪",
    expected:
      'What specifically - types, interfaces, generics? Tell me where you are stuck.',
    label: 'mixed_emoji_but_helpful',
  },
]

// ============================================================================
// Evalite Evaluation
// ============================================================================

evalite('Support Agent Response Quality', {
  data: testData.map((d) => ({
    input: d.input,
    expected: d.expected,
    metadata: { label: d.label },
  })),

  task: async (input) => {
    // In real eval, this would call the agent
    // For now, we use the pre-recorded outputs
    const match = testData.find((d) => d.input === input)
    return match?.output || ''
  },

  scorers: [
    InternalStateLeakage,
    MetaCommentary,
    BannedPhrases,
    ProductFabrication,
    Helpfulness,
  ],
})

// Export scorers for use in other evals
export {
  InternalStateLeakage,
  MetaCommentary,
  BannedPhrases,
  ProductFabrication,
  Helpfulness,
}
