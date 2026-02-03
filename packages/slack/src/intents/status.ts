import { initializeAxiom, log } from '../../../core/src/observability/axiom'
import {
  type Conversation,
  type FrontClient,
  createFrontClient,
} from '../../../front-sdk/src'
import {
  type HealthStats,
  type PendingSummaryItem,
  type StatusItem,
  formatHealthBlocks,
  formatPendingBlocks,
  formatUrgentBlocks,
} from '../formatters/status'

export interface StatusQuery {
  type: 'urgent' | 'pending' | 'health'
  filters?: {
    product?: string
    assignee?: string
    since?: Date
  }
}

export interface StatusCacheEntry<T> {
  expiresAt: number
  value: T
}

export interface StatusCache {
  get<T>(key: string): StatusCacheEntry<T> | undefined
  set<T>(key: string, entry: StatusCacheEntry<T>): void
}

export interface StatusHandlerDeps {
  frontClient?: Pick<FrontClient, 'conversations'>
  cache?: StatusCache
  now?: () => Date
  logger?: typeof log
  initializeAxiom?: typeof initializeAxiom
  traceId?: string
}

export interface StatusHandlerResult {
  text: string
  blocks: Array<Record<string, unknown>>
  cacheHit: boolean
}

const CACHE_TTL_MS = 30_000
const DEFAULT_CACHE_STORE = new Map<
  string,
  StatusCacheEntry<StatusHandlerResult>
>()
const DEFAULT_CACHE = createStatusCache(DEFAULT_CACHE_STORE)

const URGENT_TAGS = new Set([
  'urgent',
  'high-priority',
  'priority-high',
  'priority:high',
  'high priority',
])

const CATEGORY_TAG_PREFIXES = ['category:', 'issue:', 'support:']
const PRODUCT_TAG_PREFIXES = ['product:', 'app:']

export function createStatusCache(
  store = new Map<string, StatusCacheEntry<StatusHandlerResult>>()
): StatusCache {
  return {
    get: (key) => store.get(key),
    set: (key, entry) => store.set(key, entry),
  }
}

function getNow(deps?: StatusHandlerDeps): Date {
  return deps?.now ? deps.now() : new Date()
}

function getCache(deps?: StatusHandlerDeps): StatusCache {
  return deps?.cache ?? DEFAULT_CACHE
}

function getLogger(deps?: StatusHandlerDeps): typeof log {
  return deps?.logger ?? log
}

function getFrontClient(
  deps?: StatusHandlerDeps
): Pick<FrontClient, 'conversations'> {
  if (deps?.frontClient) return deps.frontClient
  const apiToken = process.env.FRONT_API_TOKEN ?? process.env.FRONT_API_KEY
  if (!apiToken) {
    throw new Error('FRONT_API_TOKEN not configured')
  }
  return createFrontClient({ apiToken })
}

function formatDateForQuery(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function buildFrontQuery(
  base: string,
  filters?: StatusQuery['filters']
): string {
  const parts = [base]
  if (filters?.product) {
    parts.push(`tag:${filters.product}`)
  }
  if (filters?.assignee) {
    parts.push(`assignee:${filters.assignee}`)
  }
  if (filters?.since) {
    parts.push(`updated:>=${formatDateForQuery(filters.since)}`)
  }
  return parts.join(' ')
}

function isUrgentConversation(conversation: Conversation): boolean {
  return conversation.tags.some((tag) =>
    URGENT_TAGS.has(tag.name.toLowerCase())
  )
}

function getConversationAgeLabel(
  conversation: Conversation,
  now: Date
): string {
  const referenceSeconds = conversation.waiting_since ?? conversation.created_at
  const ageSeconds = Math.max(
    0,
    Math.floor(now.getTime() / 1000) - referenceSeconds
  )
  const ageMinutes = Math.max(1, Math.round(ageSeconds / 60))
  if (ageMinutes < 60) {
    return `${ageMinutes}m ago`
  }
  const ageHours = Math.round(ageMinutes / 60)
  return `${ageHours}h ago`
}

function deriveProductCode(
  conversation: Conversation,
  filters?: StatusQuery['filters']
): string | undefined {
  const productTag = conversation.tags.find((tag) =>
    PRODUCT_TAG_PREFIXES.some((prefix) =>
      tag.name.toLowerCase().startsWith(prefix)
    )
  )
  const name = productTag
    ? productTag.name.split(':').slice(1).join(':').trim()
    : filters?.product

  if (!name) return undefined

  const words = name
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)

  if (words.length === 0) return undefined

  const code = words
    .slice(0, 3)
    .map((word) => word[0])
    .join('')
    .toUpperCase()

  return code || undefined
}

function deriveCategoryLabel(conversation: Conversation): string {
  const tag = conversation.tags.find((candidate) =>
    CATEGORY_TAG_PREFIXES.some((prefix) =>
      candidate.name.toLowerCase().startsWith(prefix)
    )
  )
  if (!tag) return 'Uncategorized'
  return tag.name.split(':').slice(1).join(':').trim() || tag.name
}

function deriveProductLabel(
  conversation: Conversation,
  filters?: StatusQuery['filters']
): string | undefined {
  const tag = conversation.tags.find((candidate) =>
    PRODUCT_TAG_PREFIXES.some((prefix) =>
      candidate.name.toLowerCase().startsWith(prefix)
    )
  )
  const raw = tag
    ? tag.name.split(':').slice(1).join(':').trim()
    : filters?.product
  return raw || undefined
}

function buildPendingSummary(
  conversations: Conversation[],
  filters?: StatusQuery['filters']
): PendingSummaryItem[] {
  const counts = new Map<string, number>()

  for (const conversation of conversations) {
    const category = deriveCategoryLabel(conversation)
    const product = deriveProductLabel(conversation, filters)
    const label = product ? `${product} · ${category}` : category
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }

  return Array.from(counts.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
}

async function fetchOpenConversations(
  front: Pick<FrontClient, 'conversations'>,
  filters?: StatusQuery['filters']
): Promise<Conversation[]> {
  const query = buildFrontQuery('status:open', filters)
  const results = await front.conversations.search(query)
  return results._results
}

async function fetchHandledToday(
  front: Pick<FrontClient, 'conversations'>,
  now: Date
): Promise<Conversation[]> {
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const query = buildFrontQuery(
    `status:archived updated:>=${formatDateForQuery(today)}`
  )
  const results = await front.conversations.search(query)
  return results._results
}

function calculateAverageResponseHours(
  conversations: Conversation[],
  now: Date
): number {
  if (conversations.length === 0) return 0
  const totalSeconds = conversations.reduce((sum, conversation) => {
    const referenceSeconds =
      conversation.waiting_since ?? conversation.created_at
    const delta = Math.max(
      0,
      Math.floor(now.getTime() / 1000) - referenceSeconds
    )
    return sum + delta
  }, 0)
  const averageSeconds = totalSeconds / conversations.length
  const hours = averageSeconds / 3600
  return Math.round(hours * 10) / 10
}

async function resolveCachedResult(
  cache: StatusCache,
  cacheKey: string,
  now: Date
): Promise<StatusHandlerResult | undefined> {
  const cached = cache.get<StatusHandlerResult>(cacheKey)
  if (!cached) return undefined
  if (cached.expiresAt <= now.getTime()) return undefined
  return { ...cached.value, cacheHit: true }
}

async function storeCachedResult(
  cache: StatusCache,
  cacheKey: string,
  now: Date,
  result: StatusHandlerResult
): Promise<StatusHandlerResult> {
  cache.set(cacheKey, {
    expiresAt: now.getTime() + CACHE_TTL_MS,
    value: { ...result, cacheHit: false },
  })
  return result
}

export async function handleUrgentQuery(
  query: StatusQuery,
  deps?: StatusHandlerDeps
): Promise<StatusHandlerResult> {
  const now = getNow(deps)
  const cache = getCache(deps)
  const cacheKey = `urgent:${JSON.stringify(query.filters ?? {})}`
  const logger = getLogger(deps)
  const init = deps?.initializeAxiom ?? initializeAxiom
  init()
  const cached = await resolveCachedResult(cache, cacheKey, now)
  if (cached) {
    await logger('info', 'slack.status_query', {
      traceId: deps?.traceId,
      queryType: 'urgent',
      filters: query.filters ?? {},
      urgentCount: undefined,
      cacheHit: true,
    })
    return cached
  }

  const front = getFrontClient(deps)
  const openConversations = await fetchOpenConversations(front, query.filters)
  const urgentConversations = openConversations.filter(
    (conversation) =>
      conversation.status === 'unassigned' && isUrgentConversation(conversation)
  )

  const items: StatusItem[] = urgentConversations.map((conversation) => ({
    conversationId: conversation.id,
    subject: conversation.subject,
    ageLabel: getConversationAgeLabel(conversation, now),
    productCode: deriveProductCode(conversation, query.filters),
  }))

  const formatted = formatUrgentBlocks({ items })
  const result: StatusHandlerResult = {
    ...formatted,
    cacheHit: false,
  }

  await logger('info', 'slack.status_query', {
    traceId: deps?.traceId,
    queryType: 'urgent',
    filters: query.filters ?? {},
    urgentCount: items.length,
    cacheHit: false,
  })

  return storeCachedResult(cache, cacheKey, now, result)
}

export async function handlePendingQuery(
  query: StatusQuery,
  deps?: StatusHandlerDeps
): Promise<StatusHandlerResult> {
  const now = getNow(deps)
  const cache = getCache(deps)
  const cacheKey = `pending:${JSON.stringify(query.filters ?? {})}`
  const logger = getLogger(deps)
  const init = deps?.initializeAxiom ?? initializeAxiom
  init()
  const cached = await resolveCachedResult(cache, cacheKey, now)
  if (cached) {
    await logger('info', 'slack.status_query', {
      traceId: deps?.traceId,
      queryType: 'pending',
      filters: query.filters ?? {},
      pendingCount: undefined,
      cacheHit: true,
    })
    return cached
  }

  const front = getFrontClient(deps)
  const openConversations = await fetchOpenConversations(front, query.filters)
  const summary = buildPendingSummary(openConversations, query.filters)
  const formatted = formatPendingBlocks({
    total: openConversations.length,
    summary,
  })

  const result: StatusHandlerResult = {
    ...formatted,
    cacheHit: false,
  }

  await logger('info', 'slack.status_query', {
    traceId: deps?.traceId,
    queryType: 'pending',
    filters: query.filters ?? {},
    pendingCount: openConversations.length,
    cacheHit: false,
  })

  return storeCachedResult(cache, cacheKey, now, result)
}

export async function handleHealthQuery(
  query: StatusQuery,
  deps?: StatusHandlerDeps
): Promise<StatusHandlerResult> {
  const now = getNow(deps)
  const cache = getCache(deps)
  const cacheKey = `health:${JSON.stringify(query.filters ?? {})}`
  const logger = getLogger(deps)
  const init = deps?.initializeAxiom ?? initializeAxiom
  init()
  const cached = await resolveCachedResult(cache, cacheKey, now)
  if (cached) {
    await logger('info', 'slack.status_query', {
      traceId: deps?.traceId,
      queryType: 'health',
      filters: query.filters ?? {},
      pendingCount: undefined,
      handledToday: undefined,
      averageResponseHours: undefined,
      cacheHit: true,
    })
    return cached
  }

  const front = getFrontClient(deps)
  const [openConversations, handledToday] = await Promise.all([
    fetchOpenConversations(front, query.filters),
    fetchHandledToday(front, now),
  ])

  const stats: HealthStats = {
    handledToday: handledToday.length,
    pending: openConversations.length,
    avgResponseHours: calculateAverageResponseHours(openConversations, now),
  }

  const formatted = formatHealthBlocks({ stats })
  const result: StatusHandlerResult = {
    ...formatted,
    cacheHit: false,
  }

  await logger('info', 'slack.status_query', {
    traceId: deps?.traceId,
    queryType: 'health',
    filters: query.filters ?? {},
    pendingCount: stats.pending,
    handledToday: stats.handledToday,
    averageResponseHours: stats.avgResponseHours,
    cacheHit: false,
  })

  return storeCachedResult(cache, cacheKey, now, result)
}
