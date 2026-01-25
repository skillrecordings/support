/**
 * Response quality scorers for support agent evaluation
 * 
 * These are extracted from response-quality.eval.ts for use in CLI without evalite dependency
 */

/**
 * Detects internal state leakage in responses
 * - Configuration errors exposed to customers
 * - Routing/forwarding explanations
 * - System capability limitations
 */
export const InternalStateLeakage = ({
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
export const MetaCommentary = ({
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
export const BannedPhrases = ({
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
export const ProductFabrication = ({
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
export const Helpfulness = ({
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
