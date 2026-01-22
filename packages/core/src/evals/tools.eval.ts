/**
 * Evalite-based evaluation for SDK integration tools
 *
 * Tests live tool calls against product endpoints:
 * 1. lookupUser - finds users by email
 * 2. searchContent - semantic content search
 * 3. getPurchases - retrieves purchase history
 *
 * Run: bunx evalite watch
 */

import { IntegrationClient } from '@skillrecordings/sdk/client'
import { evalite } from 'evalite'

// ============================================================================
// App Configurations
// ============================================================================

const apps = {
  'ai-hero': {
    baseUrl: 'https://www.aihero.dev/api/support/v1',
    webhookSecret: process.env.AI_HERO_WEBHOOK_SECRET!,
  },
  'total-typescript': {
    baseUrl: 'https://www.totaltypescript.com/api/support',
    webhookSecret: process.env.TOTAL_TYPESCRIPT_WEBHOOK_SECRET!,
  },
}

// ============================================================================
// Custom Scorers
// ============================================================================

/**
 * Scores user lookup results
 * - 1.0 if user found with matching email
 * - 0.5 if user found but email doesn't match
 * - 0.0 if user not found when expected
 */
const UserLookupAccuracy = ({
  output,
  expected,
}: {
  output: unknown
  expected?: string
  input?: string
}) => {
  const user = output as { id?: string; email?: string; name?: string } | null

  if (!expected) {
    // Expected no user
    return {
      name: 'user_lookup_accuracy',
      score: user === null ? 1 : 0,
      metadata: { found: !!user, expected: 'no user' },
    }
  }

  if (!user) {
    return {
      name: 'user_lookup_accuracy',
      score: 0,
      metadata: { found: false, expected },
    }
  }

  const emailMatch = user.email?.toLowerCase() === expected.toLowerCase()
  return {
    name: 'user_lookup_accuracy',
    score: emailMatch ? 1 : 0.5,
    metadata: {
      found: true,
      userId: user.id,
      foundEmail: user.email,
      expected,
      emailMatch,
    },
  }
}

/**
 * Scores search result relevance
 * - 1.0 if results contain expected terms
 * - 0.5 if some results but weak relevance
 * - 0.0 if no results
 */
const SearchRelevance = ({
  output,
  expected,
  input,
}: {
  output: unknown
  expected?: string
  input?: string
}) => {
  const response = output as {
    results?: Array<{ title?: string; description?: string }>
  }
  const results = response?.results || []

  if (results.length === 0) {
    return {
      name: 'search_relevance',
      score: 0,
      metadata: { resultCount: 0, query: input },
    }
  }

  // Extract query from JSON input
  let query = ''
  try {
    const parsed = JSON.parse(input || '{}')
    query = (parsed.query || '').toLowerCase()
  } catch {
    query = input?.toLowerCase() || ''
  }

  // Split into keywords, filter short words
  const keywords = query.split(/\s+/).filter((w) => w.length > 2)

  let relevantResults = 0
  for (const result of results) {
    const text =
      `${result.title || ''} ${result.description || ''}`.toLowerCase()
    // Check if any keyword matches
    const hasMatch = keywords.some((k) => text.includes(k))
    if (hasMatch) {
      relevantResults++
    }
  }

  const relevanceScore =
    results.length > 0 ? relevantResults / results.length : 0

  return {
    name: 'search_relevance',
    score: relevanceScore > 0.3 ? 1 : relevanceScore > 0 ? 0.5 : 0,
    metadata: {
      resultCount: results.length,
      relevantResults,
      relevanceScore,
      query,
      keywords,
    },
  }
}

/**
 * Scores purchase lookup results
 * - 1.0 if purchases found for user
 * - 0.0 if no purchases when expected
 */
const PurchaseLookupAccuracy = ({
  output,
  expected,
}: {
  output: unknown
  expected?: string
  input?: string
}) => {
  const purchases = output as Array<{
    id?: string
    productName?: string
  }> | null

  const expectPurchases = expected === 'has_purchases'
  const hasPurchases = Array.isArray(purchases) && purchases.length > 0

  return {
    name: 'purchase_lookup_accuracy',
    score: hasPurchases === expectPurchases ? 1 : 0,
    metadata: {
      purchaseCount: Array.isArray(purchases) ? purchases.length : 0,
      expected: expectPurchases ? 'has purchases' : 'no purchases',
      found: hasPurchases,
    },
  }
}

// ============================================================================
// Test Cases
// ============================================================================

interface ToolTestCase {
  app: keyof typeof apps
  tool: 'lookupUser' | 'searchContent' | 'getPurchases'
  input: string
  expected: string
  label: string
}

const toolTestCases: ToolTestCase[] = [
  // User lookup - AI Hero
  {
    app: 'ai-hero',
    tool: 'lookupUser',
    input: 'joel@egghead.io',
    expected: 'joel@egghead.io',
    label: 'ai_hero_lookup_known_user',
  },
  {
    app: 'ai-hero',
    tool: 'lookupUser',
    input: 'nonexistent-user-12345@example.com',
    expected: '',
    label: 'ai_hero_lookup_unknown_user',
  },

  // User lookup - Total TypeScript
  {
    app: 'total-typescript',
    tool: 'lookupUser',
    input: 'joel@egghead.io',
    expected: 'joel@egghead.io',
    label: 'tt_lookup_known_user',
  },
  {
    app: 'total-typescript',
    tool: 'lookupUser',
    input: 'nonexistent-user-12345@example.com',
    expected: '',
    label: 'tt_lookup_unknown_user',
  },

  // Content search - AI Hero
  {
    app: 'ai-hero',
    tool: 'searchContent',
    input: 'typescript agent',
    expected: 'relevant',
    label: 'ai_hero_search_typescript',
  },
  {
    app: 'ai-hero',
    tool: 'searchContent',
    input: 'vercel ai sdk',
    expected: 'relevant',
    label: 'ai_hero_search_ai_sdk',
  },

  // Content search - Total TypeScript
  {
    app: 'total-typescript',
    tool: 'searchContent',
    input: 'generics',
    expected: 'relevant',
    label: 'tt_search_generics',
  },
  {
    app: 'total-typescript',
    tool: 'searchContent',
    input: 'zod validation',
    expected: 'relevant',
    label: 'tt_search_zod',
  },
]

// ============================================================================
// Evalite Evaluations
// ============================================================================

// User Lookup Eval
evalite('SDK Tools - User Lookup', {
  data: toolTestCases
    .filter((t) => t.tool === 'lookupUser')
    .map((t) => ({
      input: JSON.stringify({ app: t.app, email: t.input }),
      expected: t.expected,
      metadata: { label: t.label, app: t.app },
    })),

  task: async (input) => {
    const { app, email } = JSON.parse(input) as {
      app: keyof typeof apps
      email: string
    }
    const config = apps[app]
    if (!config.webhookSecret) {
      throw new Error(`Missing webhook secret for ${app}`)
    }

    const client = new IntegrationClient({
      baseUrl: config.baseUrl,
      webhookSecret: config.webhookSecret,
    })

    try {
      return await client.lookupUser(email)
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Unknown error' }
    }
  },

  scorers: [UserLookupAccuracy],
})

// Content Search Eval
evalite('SDK Tools - Content Search', {
  data: toolTestCases
    .filter((t) => t.tool === 'searchContent')
    .map((t) => ({
      input: JSON.stringify({ app: t.app, query: t.input }),
      expected: t.expected,
      metadata: { label: t.label, app: t.app },
    })),

  task: async (input) => {
    const { app, query } = JSON.parse(input) as {
      app: keyof typeof apps
      query: string
    }
    const config = apps[app]
    if (!config.webhookSecret) {
      throw new Error(`Missing webhook secret for ${app}`)
    }

    const client = new IntegrationClient({
      baseUrl: config.baseUrl,
      webhookSecret: config.webhookSecret,
    })

    try {
      return await client.searchContent({ query, limit: 5 })
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Unknown error' }
    }
  },

  scorers: [SearchRelevance],
})

// Export scorers for use elsewhere
export { UserLookupAccuracy, SearchRelevance, PurchaseLookupAccuracy }
