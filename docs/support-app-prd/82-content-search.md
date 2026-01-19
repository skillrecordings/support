# Phase 8.2: Content Search API

> Agent queries product sites for relevant resources to share with customers.

## Problem

The support agent needs to recommend content (courses, tutorials, articles, exercises) but:
- Content changes frequently (new modules, updated resources)
- Each product has different content types and metadata
- Agent shouldn't maintain stale content indexes
- Products know their content structure best

Currently the agent either:
1. **Hallucinates content** - invents "fundamentals section" or "modules" that don't exist
2. Guesses at URLs (risky - may 404)
3. Uses hardcoded knowledge (stale)
4. Searches vector store (may miss new content)

### The Hallucination Problem

Without a content API, when a customer asks "how do I get started?", the agent has no ground truth about what the product contains. It fills the void with plausible-sounding bullshit:

> "Start with the fundamentals section in AI Hero. It covers core concepts like how AI models work, prompt engineering basics, and common use cases."

This is fabricated. The agent has no idea what AI Hero actually teaches. We've added guardrails to prevent this (`packages/core/src/agent/config.ts` - "NEVER FABRICATE PRODUCT CONTENT"), but the real fix is giving the agent actual content to reference.

## Solution

Add `contentSearch` to the SDK contract. Products implement an endpoint that returns relevant resources in a standardized format. Agent queries on-demand, products return fresh results.

## SDK Contract

### New Integration Method

```typescript
// packages/sdk/src/integration.ts

export interface ContentSearchResult {
  /** Unique identifier for deduplication */
  id: string

  /** Resource type for filtering/display */
  type: 'course' | 'module' | 'lesson' | 'article' | 'exercise' | 'resource' | 'social'

  /** Human-readable title */
  title: string

  /** Brief description (1-2 sentences) */
  description?: string

  /** Canonical URL to share with customer */
  url: string

  /** Relevance score 0-1 (optional, for ranking) */
  score?: number

  /** Product-specific metadata (agent can reference but doesn't parse) */
  metadata?: {
    /** Duration in minutes (for courses/lessons) */
    duration?: number
    /** Difficulty level */
    difficulty?: 'beginner' | 'intermediate' | 'advanced'
    /** Tags/topics */
    tags?: string[]
    /** Author/instructor name */
    author?: string
    /** Last updated date */
    updatedAt?: string
    /** Free vs paid */
    accessLevel?: 'free' | 'paid' | 'preview'
    /** Arbitrary product-specific data */
    [key: string]: unknown
  }
}

export interface ContentSearchRequest {
  /** Natural language query */
  query: string

  /** Filter by content type */
  types?: ContentSearchResult['type'][]

  /** Max results to return */
  limit?: number

  /** Customer context (for personalization) */
  customer?: {
    email?: string
    hasPurchased?: boolean
    purchasedProducts?: string[]
  }
}

export interface ContentSearchResponse {
  results: ContentSearchResult[]

  /** Quick links always returned (social, support, etc.) */
  quickLinks?: ContentSearchResult[]

  /** Search metadata */
  meta?: {
    totalResults?: number
    searchTimeMs?: number
  }
}

export interface SupportIntegration {
  // ... existing methods ...

  /**
   * Search product content for relevant resources.
   * Agent calls this to find content to recommend to customers.
   */
  searchContent(request: ContentSearchRequest): Promise<ContentSearchResponse>
}
```

### Handler Addition

```typescript
// packages/sdk/src/handler.ts

export function createSupportHandler(integration: SupportIntegration) {
  return {
    // ... existing handlers ...

    async handleContentSearch(request: ContentSearchRequest): Promise<ContentSearchResponse> {
      return integration.searchContent(request)
    }
  }
}
```

## Agent Tool

```typescript
// packages/core/src/agent/config.ts

searchProductContent: tool({
  description: 'Search product content to find relevant resources to share with customers. Use when customer asks about topics, needs learning resources, or when you want to point them to specific content.',
  inputSchema: z.object({
    query: z.string().describe('What the customer is looking for'),
    types: z.array(z.enum(['course', 'module', 'lesson', 'article', 'exercise', 'resource', 'social'])).optional(),
    limit: z.number().optional().default(5),
  }),
  execute: async ({ query, types, limit }, context) => {
    const app = (context as any)?.appConfig
    if (!app) return { results: [], error: 'No app context' }

    const client = new IntegrationClient({
      baseUrl: app.integration_base_url,
      webhookSecret: app.webhook_secret,
    })

    const response = await client.searchContent({ query, types, limit })
    return response
  },
}),
```

## Product Implementation Example

### Total TypeScript

```typescript
// total-typescript/app/api/support/content-search/route.ts

import { withSupportHandler } from '@skillrecordings/sdk/handler'
import { searchContent } from '@/lib/content-search'

export const POST = withSupportHandler(async (req) => {
  const { query, types, limit = 5, customer } = await req.json()

  // Search internal content index
  const results = await searchContent(query, { types, limit })

  // Always include quick links
  const quickLinks = [
    {
      id: 'discord',
      type: 'social',
      title: 'Total TypeScript Discord',
      description: 'Join the community for discussions and help',
      url: 'https://totaltypescript.com/discord',
    },
    {
      id: 'twitter',
      type: 'social',
      title: 'Matt on Twitter',
      description: 'Follow Matt for TypeScript tips',
      url: 'https://x.com/mattpocockuk',
    },
  ]

  return Response.json({
    results: results.map(r => ({
      id: r.slug,
      type: r.type,
      title: r.title,
      description: r.summary,
      url: `https://totaltypescript.com/${r.path}`,
      score: r.score,
      metadata: {
        duration: r.durationMinutes,
        difficulty: r.difficulty,
        tags: r.tags,
        author: 'Matt Pocock',
        accessLevel: r.isFree ? 'free' : 'paid',
      },
    })),
    quickLinks,
    meta: {
      totalResults: results.length,
    },
  })
})
```

## Use Cases

### 1. Customer asks about a topic

```
Customer: "How do I use generics in TypeScript?"

Agent calls: searchContent({ query: "generics typescript" })

Response includes:
- Lesson: "Generic Functions" (beginner)
- Lesson: "Generic Constraints" (intermediate)
- Exercise: "Build a Generic Utility Type"
- Article: "When to Use Generics"

Agent: "Here are some resources on generics:
- Start with Generic Functions if you're new to them
- Generic Constraints covers more advanced patterns
- There's also a hands-on exercise..."
```

### 2. Customer wants community resources

```
Customer: "Is there a Discord or community?"

Agent calls: searchContent({ query: "community discord", types: ['social'] })

Response includes quickLinks:
- Discord link
- Twitter
- GitHub discussions

Agent: "Join the Total TypeScript Discord: [link]
Matt's also active on Twitter if you want TypeScript tips."
```

### 3. Customer asks about specific content

```
Customer: "Do you have anything on React Server Components?"

Agent calls: searchContent({ query: "react server components RSC" })

Response: (empty or limited results)

Agent: "I don't see specific RSC content in the Total TypeScript curriculum right now.
The focus is on TypeScript fundamentals. For RSC, I'd check the React docs or
Matt's Twitter where he shares thoughts on it."
```

## Caching Strategy

### Agent-side caching (optional)

```typescript
// packages/core/src/cache/content-cache.ts

const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

interface CacheEntry {
  response: ContentSearchResponse
  timestamp: number
}

const cache = new Map<string, CacheEntry>()

function getCacheKey(appId: string, request: ContentSearchRequest): string {
  return `${appId}:${request.query}:${request.types?.join(',')}:${request.limit}`
}

export async function cachedContentSearch(
  appId: string,
  request: ContentSearchRequest,
  fetcher: () => Promise<ContentSearchResponse>
): Promise<ContentSearchResponse> {
  const key = getCacheKey(appId, request)
  const cached = cache.get(key)

  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.response
  }

  const response = await fetcher()
  cache.set(key, { response, timestamp: Date.now() })
  return response
}
```

### Quick links caching

Quick links (social, support pages) are semi-static. Cache longer:

```typescript
// Cache quick links for 24h, refresh on first content search of the day
const quickLinksCache = new Map<string, { links: ContentSearchResult[], timestamp: number }>()
const QUICK_LINKS_TTL = 24 * 60 * 60 * 1000
```

## Response Format Guidelines

### Required fields (agent depends on these)
- `id`: Deduplication
- `type`: Display/filtering
- `title`: Show to customer
- `url`: Share with customer

### Recommended fields
- `description`: Agent uses for context
- `metadata.difficulty`: Helps agent recommend appropriately
- `metadata.accessLevel`: Agent knows if customer can access

### Product-specific metadata
Products can add arbitrary metadata. Agent includes it in context but doesn't parse it:

```typescript
metadata: {
  // Standard fields agent understands
  difficulty: 'intermediate',
  accessLevel: 'paid',

  // Product-specific (ignored by agent, useful for debugging)
  moduleId: 'mod_abc123',
  sectionIndex: 3,
  hasExercises: true,
}
```

## Reference Implementations

Current products have completely different search architectures. The SDK adapter pattern normalizes them to our interface - we don't care HOW you search, just that you return `ContentSearchResponse`.

### AI Hero: Typesense (Dedicated Search Engine)

**Source**: `/Users/joel/Code/badass-courses/course-builder/apps/ai-hero/src/app/(search)/q/_components/search.tsx`
**Adapter**: `/Users/joel/Code/badass-courses/course-builder/apps/ai-hero/src/utils/typesense-instantsearch-adapter.ts`

AI Hero uses **Typesense**, a dedicated search engine with:
- InstantSearch adapter for client-side faceted search
- Searches: `title, description, summary`
- Filters: `visibility:public && state:published`
- Faceted refinements: type, tags
- Sorting by relevance (`_text_match:desc`) or recency

```typescript
// Current implementation (client-side InstantSearch)
const config = createDefaultConfig({
  apiKey: process.env.NEXT_PUBLIC_TYPESENSE_API_KEY,
  host: process.env.NEXT_PUBLIC_TYPESENSE_HOST,
  queryBy: 'title,description,summary',
  sortBy: '_text_match:desc',
})

export const typesenseInstantsearchAdapter = new TypesenseInstantSearchAdapter(config)
```

**Adapter strategy**: Create server-side Typesense client, query directly, transform to `ContentSearchResult[]`:

```typescript
// ai-hero/app/api/support/content-search/route.ts

import Typesense from 'typesense'
import { withSupportHandler } from '@skillrecordings/sdk/handler'

const client = new Typesense.Client({
  apiKey: process.env.TYPESENSE_API_KEY,
  nodes: [{ host: process.env.TYPESENSE_HOST, port: 443, protocol: 'https' }],
})

export const POST = withSupportHandler(async (req) => {
  const { query, types, limit = 5 } = await req.json()

  const searchParams = {
    q: query,
    query_by: 'title,description,summary',
    filter_by: 'visibility:public && state:published',
    per_page: limit,
  }

  if (types?.length) {
    searchParams.filter_by += ` && type:[${types.join(',')}]`
  }

  const results = await client
    .collections('content_production')
    .documents()
    .search(searchParams)

  return Response.json({
    results: results.hits.map(hit => ({
      id: hit.document.id,
      type: hit.document.type,
      title: hit.document.title,
      description: hit.document.description,
      url: `https://aihero.dev/${hit.document.slug}`,
      score: hit.text_match / 100, // Normalize to 0-1
      metadata: {
        tags: hit.document.tags?.map(t => t.fields?.label),
        author: hit.document.instructor_name,
        updatedAt: hit.document.updated_at,
      },
    })),
    quickLinks: [
      { id: 'discord', type: 'social', title: 'AI Hero Discord', url: 'https://aihero.dev/discord' },
    ],
  })
})
```

### Total TypeScript: Sanity GROQ (CMS Query Language)

**Source**: `/Users/joel/Code/skillrecordings/products/apps/total-typescript/src/trpc/routers/search.ts`

Total TypeScript uses **Sanity CMS** with GROQ full-text search:
- Server-side tRPC router
- Searches: `title, description, body, transcript`
- Boost scoring for relevance weighting
- Returns hierarchical content structure (module → section → chapter → book)

```typescript
// Current implementation (tRPC + GROQ)
const results = await sanityClient.fetch(
  groq`*[_type in ["article", "tip", "module", "exercise", "explainer"]
       && state == "published"]
  | score(
    title match $searchQuery
    || description match $searchQuery
    || pt::text(body) match $searchQuery
    || boost(pt::text(transcript) match $searchQuery, 0.5)
  )
  | order(_score desc)
  {
    _score, _id, title, slug, _type, description,
    "section": *[_type == 'section' && references(^._id)][0]{...},
    "module": *[_type == 'module' && references(^.section._id)][0]{...}
  }
  [_score > 0][0..${limit}]`,
  { searchQuery: query }
)
```

**Adapter strategy**: Wrap existing GROQ query, transform to `ContentSearchResult[]`:

```typescript
// total-typescript/app/api/support/content-search/route.ts

import { sanityClient } from '@skillrecordings/skill-lesson/utils/sanity-client'
import { withSupportHandler } from '@skillrecordings/sdk/handler'
import groq from 'groq'

export const POST = withSupportHandler(async (req) => {
  const { query, types, limit = 5 } = await req.json()

  const typeFilter = types?.length
    ? `_type in [${types.map(t => `"${mapType(t)}"`).join(',')}]`
    : `_type in ["article", "tip", "module", "exercise", "explainer"]`

  const results = await sanityClient.fetch(
    groq`*[${typeFilter} && state == "published"]
    | score(
      title match $searchQuery
      || description match $searchQuery
      || pt::text(body) match $searchQuery
    )
    | order(_score desc)
    { _score, _id, title, slug, _type, description, moduleType }
    [_score > 0][0..${limit}]`,
    { searchQuery: query }
  )

  return Response.json({
    results: results.map(r => ({
      id: r._id,
      type: mapSanityType(r._type, r.moduleType),
      title: r.title,
      description: r.description,
      url: buildUrl(r),
      score: r._score / 100,
      metadata: {
        author: 'Matt Pocock',
        sanityType: r._type,
      },
    })),
    quickLinks: [
      { id: 'discord', type: 'social', title: 'Total TypeScript Discord', url: 'https://totaltypescript.com/discord' },
      { id: 'twitter', type: 'social', title: 'Matt on Twitter', url: 'https://x.com/mattpocockuk' },
    ],
  })
})

function mapSanityType(type: string, moduleType?: string): ContentSearchResult['type'] {
  if (type === 'module') return moduleType === 'tutorial' ? 'course' : 'module'
  if (type === 'exercise') return 'exercise'
  if (type === 'article' || type === 'tip') return 'article'
  return 'lesson'
}

function buildUrl(r: any): string {
  const base = 'https://totaltypescript.com'
  if (r._type === 'module') return `${base}/tutorials/${r.slug.current}`
  if (r._type === 'article') return `${base}/articles/${r.slug.current}`
  if (r._type === 'tip') return `${base}/tips/${r.slug.current}`
  return `${base}/${r.slug.current}`
}
```

### Why This Pattern Works

| Aspect | AI Hero | Total TypeScript | SDK Interface |
|--------|---------|------------------|---------------|
| **Search engine** | Typesense | Sanity GROQ | Doesn't care |
| **Query language** | Typesense DSL | GROQ | Natural language |
| **Scoring** | `_text_match` | `score()` | Normalized 0-1 |
| **Content types** | Flat | Hierarchical | Enum mapped |
| **Response** | Typesense hits | Sanity documents | `ContentSearchResult[]` |

The adapter lives in each product's codebase - they transform their search results to our interface. Support platform sees consistent `ContentSearchResponse` regardless of underlying implementation.

## Implementation Plan

### Phase 1: SDK Contract
1. Add types to `packages/sdk/src/types.ts`
2. Add `searchContent` to `SupportIntegration` interface
3. Add handler method
4. Add agent tool

### Phase 2: AI Hero Implementation
1. Create server-side Typesense client (reuse existing config)
2. Implement `/api/support/content-search` route
3. Map Typesense hits → `ContentSearchResult[]`
4. Add quick links (Discord, etc.)

### Phase 3: Total TypeScript Implementation
1. Wrap existing GROQ query in new endpoint
2. Implement `/api/support/content-search` route
3. Map Sanity documents → `ContentSearchResult[]`
4. Handle hierarchical content (module → lesson paths)

### Phase 4: Caching & Optimization
1. Add agent-side caching
2. Add quick links caching
3. Monitor latency/cache hit rates

## Non-Goals

- **Full-text search on agent side**: Products own their search
- **Content ingestion**: Agent doesn't store product content
- **Personalized recommendations**: Products can personalize, agent just passes customer context
- **Content editing**: Read-only API

## Open Questions

1. **Should agent store search results in vector DB for future reference?**
   - Pro: Build up knowledge of what content exists
   - Con: Staleness, complexity
   - Recommendation: No, keep it simple. Fresh queries are fine.

2. **Rate limiting?**
   - Products should implement their own rate limiting
   - Agent shouldn't hammer the endpoint (use caching)

3. **Fallback when endpoint unavailable?**
   - Return empty results
   - Agent should gracefully handle: "I can't search content right now, but here's the main site..."
