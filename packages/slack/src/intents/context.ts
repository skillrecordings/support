import {
  type Conversation,
  type FrontClient,
  createFrontClient,
} from '@skillrecordings/front-sdk'
import { initializeAxiom, log } from '../../../core/src/observability/axiom'
import type { Purchase, User } from '../../../sdk/src/integration'
import {
  formatCustomerHistoryBlocks,
  formatCustomerProfileBlocks,
  formatCustomerPurchasesBlocks,
} from '../formatters/customer'

export interface CustomerQuery {
  type: 'history' | 'profile' | 'purchases'
  email: string
}

export interface CustomerProfile {
  email: string
  name?: string
  products: string[]
  lifetimeValue: number
  supportStats: {
    totalTickets: number
    resolvedTickets: number
    lastContact?: Date
  }
}

export interface CustomerHistoryItem {
  conversationId: string
  subject: string
  status: 'resolved' | 'open'
  createdAt: Date
}

export interface CustomerPurchaseSummary {
  productName: string
  purchasedAt?: Date
}

export interface CustomerContextDeps {
  frontClient?: Pick<FrontClient, 'conversations'>
  lookupUser?: (email: string) => Promise<User | null> | User | null
  purchaseLookup?: (email: string) => Promise<Purchase[]> | Purchase[]
  now?: () => Date
  logger?: typeof log
  initializeAxiom?: typeof initializeAxiom
  traceId?: string
}

export interface CustomerContextResult<T = undefined> {
  text: string
  blocks: Array<Record<string, unknown>>
  empty: boolean
  data?: T
  profile?: CustomerProfile
}

const emailRegex = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i

function extractEmail(text: string): string | undefined {
  const match = text.match(emailRegex)
  return match?.[0]
}

function extractIdentifier(text: string): string | undefined {
  const match = text.match(
    /\b(?:history with|who is|purchases for|purchase history for)\s+([^?!.]+)$/i
  )
  if (!match?.[1]) return undefined
  return match[1].trim().replace(/[\s,]+$/g, '')
}

export function parseCustomerQuery(rawText: string): CustomerQuery | null {
  const text = rawText.trim()
  if (!text) return null

  const normalized = text.toLowerCase()
  const email = extractEmail(text)
  const identifier = extractIdentifier(text)

  if (normalized.includes('who is')) {
    const target = email ?? identifier
    if (!target) return null
    return { type: 'profile', email: target }
  }

  if (normalized.includes('purchase')) {
    const target = email ?? identifier
    if (!target) return null
    return { type: 'purchases', email: target }
  }

  if (normalized.includes('history')) {
    const target = email ?? identifier
    if (!target) return null
    return { type: 'history', email: target }
  }

  return null
}

function getFrontClient(
  deps?: CustomerContextDeps
): Pick<FrontClient, 'conversations'> {
  if (deps?.frontClient) return deps.frontClient
  const apiToken = process.env.FRONT_API_TOKEN ?? process.env.FRONT_API_KEY
  if (!apiToken) {
    throw new Error('FRONT_API_TOKEN not configured')
  }
  return createFrontClient({ apiToken })
}

function getLogger(deps?: CustomerContextDeps): typeof log {
  return deps?.logger ?? log
}

function getInitializer(deps?: CustomerContextDeps): typeof initializeAxiom {
  return deps?.initializeAxiom ?? initializeAxiom
}

function getNow(deps?: CustomerContextDeps): Date {
  return deps?.now ? deps.now() : new Date()
}

function buildHistoryQuery(email: string): string {
  return `contact:${email}`
}

async function fetchHistory(
  email: string,
  deps?: CustomerContextDeps
): Promise<Conversation[]> {
  const front = getFrontClient(deps)
  const results = await front.conversations.search(buildHistoryQuery(email))
  return results._results
}

function mapHistory(conversations: Conversation[]): CustomerHistoryItem[] {
  return conversations
    .slice()
    .sort((a, b) => b.created_at - a.created_at)
    .map((conversation) => ({
      conversationId: conversation.id,
      subject: conversation.subject,
      status: conversation.status === 'archived' ? 'resolved' : 'open',
      createdAt: new Date(conversation.created_at * 1000),
    }))
}

function buildSupportStats(
  conversations: Conversation[]
): CustomerProfile['supportStats'] {
  if (conversations.length === 0) {
    return { totalTickets: 0, resolvedTickets: 0 }
  }

  const resolvedTickets = conversations.filter(
    (conversation) => conversation.status === 'archived'
  ).length

  const lastContactSeconds = conversations.reduce(
    (latest, conversation) => Math.max(latest, conversation.created_at),
    0
  )

  return {
    totalTickets: conversations.length,
    resolvedTickets,
    lastContact: lastContactSeconds
      ? new Date(lastContactSeconds * 1000)
      : undefined,
  }
}

function summarizePurchases(purchases: Purchase[]): {
  products: string[]
  lifetimeValue: number
  summaries: CustomerPurchaseSummary[]
} {
  const products = Array.from(
    new Set(purchases.map((purchase) => purchase.productName))
  )

  const lifetimeValue = Math.round(
    purchases.reduce((sum, purchase) => sum + purchase.amount, 0) / 100
  )

  const summaries = purchases.map((purchase) => ({
    productName: purchase.productName,
    purchasedAt: purchase.purchasedAt,
  }))

  return { products, lifetimeValue, summaries }
}

async function logQuery(
  deps: CustomerContextDeps | undefined,
  payload: Record<string, unknown>,
  level: 'info' | 'warn' | 'error' = 'info'
): Promise<void> {
  const logger = getLogger(deps)
  const init = getInitializer(deps)
  init()
  await logger(level, 'slack.customer_context', {
    traceId: deps?.traceId,
    ...payload,
  })
}

export async function handleHistoryQuery(
  query: CustomerQuery,
  deps?: CustomerContextDeps
): Promise<CustomerContextResult<CustomerHistoryItem[]>> {
  const conversations = await fetchHistory(query.email, deps)
  const history = mapHistory(conversations)
  const formatted = formatCustomerHistoryBlocks({
    email: query.email,
    history,
  })

  const result: CustomerContextResult<CustomerHistoryItem[]> = {
    ...formatted,
    empty: history.length === 0,
    data: history,
  }

  await logQuery(deps, {
    queryType: 'history',
    email: query.email,
    ticketCount: history.length,
  })

  return result
}

export async function handlePurchasesQuery(
  query: CustomerQuery,
  deps?: CustomerContextDeps
): Promise<CustomerContextResult<CustomerPurchaseSummary[]>> {
  const purchases = deps?.purchaseLookup
    ? await deps.purchaseLookup(query.email)
    : []
  const summary = summarizePurchases(purchases)
  const formatted = formatCustomerPurchasesBlocks({
    email: query.email,
    purchases: summary.summaries,
  })

  const result: CustomerContextResult<CustomerPurchaseSummary[]> = {
    ...formatted,
    empty: summary.summaries.length === 0,
    data: summary.summaries,
  }

  await logQuery(deps, {
    queryType: 'purchases',
    email: query.email,
    purchaseCount: summary.summaries.length,
  })

  return result
}

export async function handleProfileQuery(
  query: CustomerQuery,
  deps?: CustomerContextDeps
): Promise<CustomerContextResult<CustomerProfile>> {
  const now = getNow(deps)
  const [conversations, user, purchases] = await Promise.all([
    fetchHistory(query.email, deps),
    deps?.lookupUser ? deps.lookupUser(query.email) : null,
    deps?.purchaseLookup ? deps.purchaseLookup(query.email) : [],
  ])

  const stats = buildSupportStats(conversations)
  const summary = summarizePurchases(purchases)
  const profile: CustomerProfile = {
    email: query.email,
    name: user?.name,
    products: summary.products,
    lifetimeValue: summary.lifetimeValue,
    supportStats: stats,
  }

  const history = mapHistory(conversations).slice(0, 5)
  const formatted = formatCustomerProfileBlocks({
    profile,
    purchases: summary.summaries,
    history,
    now,
  })

  const result: CustomerContextResult<CustomerProfile> = {
    ...formatted,
    empty: history.length === 0 && summary.summaries.length === 0,
    data: profile,
    profile,
  }

  await logQuery(deps, {
    queryType: 'profile',
    email: query.email,
    ticketCount: conversations.length,
    purchaseCount: summary.summaries.length,
  })

  return result
}
