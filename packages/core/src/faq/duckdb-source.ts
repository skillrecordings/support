/**
 * DuckDB Data Source for FAQ Mining
 *
 * Provides access to the cached Front conversations in DuckDB
 * instead of live Front API. Enables fast, repeatable extraction
 * without API rate limits.
 *
 * @module faq/duckdb-source
 */

import type { Conversation, Message } from '@skillrecordings/front-sdk'
import { shouldFilter } from './filters'
import type { DataSource, QueryOptions, ResolvedConversation } from './types'

/**
 * Configuration for the DuckDB data source.
 */
export interface DuckDBSourceConfig {
  /** Path to the DuckDB database file */
  dbPath: string
  /** Filter by specific inbox IDs */
  inboxIds?: string[]
  /** Minimum thread message count */
  minThreadLength?: number
  /** Maximum thread message count */
  maxThreadLength?: number
  /** Filter by conversation status (default: ['archived']) */
  statusFilter?: string[]
}

/**
 * Cache statistics from DuckDB.
 */
export interface CacheStats {
  /** Total conversations in cache */
  totalConversations: number
  /** Conversations matching filters */
  filteredConversations: number
  /** Total messages in cache */
  totalMessages: number
  /** Unique inboxes */
  inboxCount: number
  /** Date range of conversations */
  dateRange: {
    oldest: Date | null
    newest: Date | null
  }
}

/**
 * Row type from DuckDB conversations table.
 */
interface ConversationRow {
  id: string
  inbox_id: string
  subject: string | null
  status: string | null
  customer_email: string | null
  customer_name: string | null
  tags: string[] | null
  assignee_email: string | null
  created_at: Date | null
  last_message_at: Date | null
  synced_at: Date | null
  parent_id: string | null
  thread_depth: number | null
}

/**
 * Row type from DuckDB messages table.
 */
interface MessageRow {
  id: string
  conversation_id: string
  is_inbound: boolean
  author_email: string | null
  author_name: string | null
  body_text: string | null
  body_html: string | null
  created_at: Date | null
}

/**
 * Inbox ID to App slug mapping.
 * Derived from the DuckDB inboxes table and app registry.
 */
const INBOX_TO_APP: Record<string, string> = {
  inb_1bwzr: 'epic-react', // KCD Support (Epic React is the main product)
  inb_3srbb: 'total-typescript',
  inb_1c77r: 'egghead',
  inb_jqs11: 'epic-ai',
  inb_3pqh3: 'pro-tailwind',
  inb_2odqf: 'just-javascript',
  inb_4bj7r: 'ai-hero',
  inb_3bkef: 'testing-accessibility',
  inb_jqs2t: 'epic-web',
  inb_1zh3b: 'egghead',
  inb_43olj: 'pro-nextjs',
}

/**
 * App slug to inbox ID mapping (reverse of above).
 */
const APP_TO_INBOX: Record<string, string[]> = Object.entries(
  INBOX_TO_APP
).reduce(
  (acc, [inboxId, appSlug]) => {
    if (!acc[appSlug]) {
      acc[appSlug] = []
    }
    acc[appSlug]!.push(inboxId)
    return acc
  },
  {} as Record<string, string[]>
)

/**
 * Convert a DuckDB message row to Front SDK Message format.
 */
function toFrontMessage(row: MessageRow): Message {
  const createdAt = toJSDate(row.created_at)
  const createdAtTimestamp = createdAt
    ? Math.floor(createdAt.getTime() / 1000)
    : 0

  return {
    id: row.id,
    type: 'email',
    is_inbound: row.is_inbound,
    is_draft: false,
    error_type: null,
    version: null,
    created_at: createdAtTimestamp,
    subject: '',
    blurb: row.body_text?.slice(0, 100) ?? '',
    body: row.body_html ?? row.body_text ?? '',
    text: row.body_text ?? '',
    author: row.author_email
      ? {
          id: row.author_email,
          email: row.author_email,
          first_name: row.author_name?.split(' ')[0] ?? '',
          last_name: row.author_name?.split(' ').slice(1).join(' ') ?? '',
          is_admin: !row.is_inbound,
          is_available: true,
          is_blocked: false,
        }
      : null,
    recipients: [],
    attachments: [],
    metadata: {},
    _links: {
      self: `https://api.frontapp.com/messages/${row.id}`,
      related: {
        conversation: `https://api.frontapp.com/conversations/${row.conversation_id}`,
      },
    },
  }
}

/**
 * Convert a DuckDB conversation row to Front SDK Conversation format.
 */
function toFrontConversation(row: ConversationRow): Conversation {
  const createdAt = toJSDate(row.created_at)
  const createdAtTimestamp = createdAt
    ? Math.floor(createdAt.getTime() / 1000)
    : 0

  return {
    id: row.id,
    subject: row.subject ?? '',
    status: row.status === 'archived' ? 'archived' : (row.status as any),
    assignee: row.assignee_email
      ? {
          id: row.assignee_email,
          email: row.assignee_email,
          first_name: '',
          last_name: '',
        }
      : null,
    recipient: row.customer_email
      ? {
          handle: row.customer_email,
          role: 'from',
        }
      : null,
    tags: (row.tags ?? []).map((tag) => ({
      id: tag,
      name: tag,
    })),
    links: [],
    created_at: createdAtTimestamp,
    is_private: false,
    scheduled_reminders: [],
    metadata: {},
    _links: {
      self: `https://api.frontapp.com/conversations/${row.id}`,
      related: {
        events: '',
        followers: '',
        messages: '',
        comments: '',
        inboxes: '',
      },
    },
  }
}

/**
 * Extract the customer's question from conversation messages.
 * Returns the first inbound message text.
 */
function extractQuestion(messages: Message[]): string {
  // Sort by timestamp ascending
  const sorted = [...messages].sort((a, b) => a.created_at - b.created_at)

  // Find first inbound message
  const firstInbound = sorted.find((m) => m.is_inbound)
  if (!firstInbound) {
    return ''
  }

  // Prefer text, fall back to stripped HTML
  const text =
    firstInbound.text ??
    firstInbound.body
      ?.replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() ??
    ''

  return text
}

/**
 * Extract the agent's answer from conversation messages.
 * Returns the last outbound message before resolution.
 */
function extractAnswer(messages: Message[]): string {
  // Sort by timestamp descending
  const sorted = [...messages].sort((a, b) => b.created_at - a.created_at)

  // Find last outbound message
  const lastOutbound = sorted.find((m) => !m.is_inbound)
  if (!lastOutbound) {
    return ''
  }

  return (
    lastOutbound.text ??
    lastOutbound.body
      ?.replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() ??
    ''
  )
}

/**
 * Check if a question looks like spam or noise.
 * Uses the comprehensive filter module for consistency.
 */
function isSpamOrNoise(text: string, senderEmail?: string): boolean {
  // Too short
  if (text.trim().length < 20) return true

  // Use the comprehensive filter module
  const result = shouldFilter(text, senderEmail)
  return result.filtered
}

// DuckDB connection interface
interface DuckDBConnection {
  runAndReadAll(
    sql: string,
    values?: Record<string, any>
  ): Promise<{
    getRowObjects(): Record<string, any>[]
    getRowObjectsJS(): Record<string, any>[]
  }>
  closeSync(): void
}

interface DuckDBInstanceType {
  connect(): Promise<DuckDBConnection>
}

/**
 * Convert a DuckDB value to a JS Date.
 * DuckDB returns custom DuckDBTimestampValue objects.
 */
function toJSDate(value: any): Date | null {
  if (value === null || value === undefined) {
    return null
  }
  // If it's already a Date, return it
  if (value instanceof Date) {
    return value
  }
  // DuckDB timestamp values have a micros property (BigInt)
  if (typeof value === 'object' && 'micros' in value) {
    // Convert microseconds to milliseconds
    const ms = Number(value.micros) / 1000
    return new Date(ms)
  }
  // If it's a number (unix timestamp in seconds or ms)
  if (typeof value === 'number') {
    // Check if it's seconds (< 10 billion) or milliseconds
    if (value < 1000000000) {
      return new Date(value * 1000)
    }
    return new Date(value)
  }
  // If it's a string, try parsing
  if (typeof value === 'string') {
    return new Date(value)
  }
  return null
}

/**
 * Create a DuckDB data source for FAQ mining.
 *
 * @param config - DuckDB source configuration
 * @returns DataSource implementation
 *
 * @example
 * ```ts
 * const source = await createDuckDBSource({
 *   dbPath: '~/skill/data/front-cache.db',
 *   inboxIds: ['inb_3srbb'], // Total TypeScript
 * })
 *
 * const conversations = await source.getConversations({
 *   appId: 'total-typescript',
 *   since: new Date('2024-01-01'),
 *   limit: 500,
 * })
 * ```
 */
export async function createDuckDBSource(
  config: DuckDBSourceConfig
): Promise<DataSource> {
  // Dynamically import DuckDB to avoid bundling issues
  const { DuckDBInstance } = await import('@duckdb/node-api')

  const instance = (await DuckDBInstance.create(
    config.dbPath
  )) as unknown as DuckDBInstanceType
  const connection = await instance.connect()

  const statusFilter = config.statusFilter ?? ['archived']

  return {
    name: 'duckdb-cache',

    async getConversations(
      options: QueryOptions
    ): Promise<ResolvedConversation[]> {
      const { appId, since, limit = 500 } = options

      // Resolve inbox IDs from app slug
      let inboxIds = config.inboxIds
      if (!inboxIds && appId) {
        inboxIds = APP_TO_INBOX[appId]
        if (!inboxIds || inboxIds.length === 0) {
          console.warn(`No inbox mapping found for app: ${appId}`)
          return []
        }
      }

      // Build query with filters using named parameters
      const whereClauses: string[] = []
      const params: Record<string, any> = {}

      // Status filter
      if (statusFilter.length > 0) {
        whereClauses.push(
          `status IN (${statusFilter.map((_, i) => `$status_${i}`).join(', ')})`
        )
        statusFilter.forEach((s, i) => {
          params[`status_${i}`] = s
        })
      }

      // Inbox filter
      if (inboxIds && inboxIds.length > 0) {
        whereClauses.push(
          `inbox_id IN (${inboxIds.map((_, i) => `$inbox_${i}`).join(', ')})`
        )
        inboxIds.forEach((id, i) => {
          params[`inbox_${i}`] = id
        })
      }

      // Date filter - convert to ISO string for DuckDB
      if (since) {
        whereClauses.push(`last_message_at >= $since::TIMESTAMP`)
        params.since = since.toISOString()
      }

      // Thread length filters
      if (config.minThreadLength !== undefined) {
        whereClauses.push(`thread_depth >= $minThreadLength`)
        params.minThreadLength = config.minThreadLength
      }
      if (config.maxThreadLength !== undefined) {
        whereClauses.push(`thread_depth <= $maxThreadLength`)
        params.maxThreadLength = config.maxThreadLength
      }

      const whereClause =
        whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : ''

      const query = `
        SELECT *
        FROM conversations
        ${whereClause}
        ORDER BY last_message_at DESC
        LIMIT $limit
      `
      params.limit = limit

      const reader = await connection.runAndReadAll(query, params)
      const rows = reader.getRowObjectsJS() as ConversationRow[]

      console.log(`DuckDB: Found ${rows.length} conversations matching filters`)

      // Fetch messages and convert to ResolvedConversation
      const results: ResolvedConversation[] = []
      let processed = 0

      for (const row of rows) {
        processed++
        if (processed % 100 === 0) {
          console.log(`Processing ${processed}/${rows.length}...`)
        }

        // Get messages for this conversation
        const messagesReader = await connection.runAndReadAll(
          `SELECT * FROM messages WHERE conversation_id = $convId ORDER BY created_at ASC`,
          { convId: row.id }
        )
        const messageRows = messagesReader.getRowObjectsJS() as MessageRow[]

        if (messageRows.length === 0) {
          continue // Skip conversations without messages
        }

        const messages = messageRows.map(toFrontMessage)
        const conversation = toFrontConversation(row)

        // Extract Q&A
        const question = extractQuestion(messages)
        const answer = extractAnswer(messages)

        if (!question || !answer) {
          continue // Skip if we can't extract Q&A
        }

        // Get sender email from first inbound message for filtering
        const firstInbound = messages.find((m) => m.is_inbound)
        const senderEmail = firstInbound?.author?.email

        // Filter spam using comprehensive filter module
        if (isSpamOrNoise(question, senderEmail)) {
          continue
        }

        // Also filter answers that are just auto-replies
        const answerFilter = shouldFilter(answer)
        if (answerFilter.filtered && answerFilter.reason === 'auto_reply') {
          continue
        }

        // Filter spam-tagged conversations
        const tagNames = (row.tags ?? []).map((t) => t.toLowerCase())
        if (tagNames.includes('spam') || tagNames.includes('collaboration')) {
          continue
        }

        // Determine appId from inbox
        const resolvedAppId = appId ?? INBOX_TO_APP[row.inbox_id] ?? 'unknown'

        results.push({
          conversationId: row.id,
          question,
          answer,
          subject: row.subject ?? '',
          resolvedAt: toJSDate(row.last_message_at) ?? new Date(),
          appId: resolvedAppId,
          wasUnchanged: false, // Unknown from cache
          draftSimilarity: undefined,
          tags: row.tags ?? [],
          _raw: {
            conversation,
            messages,
          },
        })
      }

      console.log(
        `DuckDB: Extracted ${results.length} conversations with Q&A pairs`
      )
      return results
    },

    async getMessages(conversationId: string): Promise<Message[]> {
      const reader = await connection.runAndReadAll(
        `SELECT * FROM messages WHERE conversation_id = $convId ORDER BY created_at ASC`,
        { convId: conversationId }
      )
      const rows = reader.getRowObjectsJS() as MessageRow[]
      return rows.map(toFrontMessage)
    },

    async getStats(): Promise<CacheStats> {
      // Total conversations
      const totalReader = await connection.runAndReadAll(
        `SELECT COUNT(*) as count FROM conversations`
      )
      const totalRows = totalReader.getRowObjectsJS() as Array<{
        count: bigint | number
      }>
      const totalConversations = Number(totalRows[0]?.count ?? 0)

      // Filtered conversations
      const filterClauses: string[] = []
      const filterParams: Record<string, any> = {}

      if (statusFilter.length > 0) {
        filterClauses.push(
          `status IN (${statusFilter.map((_, i) => `$status_${i}`).join(', ')})`
        )
        statusFilter.forEach((s, i) => {
          filterParams[`status_${i}`] = s
        })
      }
      if (config.inboxIds && config.inboxIds.length > 0) {
        filterClauses.push(
          `inbox_id IN (${config.inboxIds.map((_, i) => `$inbox_${i}`).join(', ')})`
        )
        config.inboxIds.forEach((id, i) => {
          filterParams[`inbox_${i}`] = id
        })
      }

      const filterWhere =
        filterClauses.length > 0 ? `WHERE ${filterClauses.join(' AND ')}` : ''

      const filteredReader = await connection.runAndReadAll(
        `SELECT COUNT(*) as count FROM conversations ${filterWhere}`,
        filterParams
      )
      const filteredRows = filteredReader.getRowObjectsJS() as Array<{
        count: bigint | number
      }>
      const filteredConversations = Number(filteredRows[0]?.count ?? 0)

      // Total messages
      const messagesReader = await connection.runAndReadAll(
        `SELECT COUNT(*) as count FROM messages`
      )
      const messagesRows = messagesReader.getRowObjectsJS() as Array<{
        count: bigint | number
      }>
      const totalMessages = Number(messagesRows[0]?.count ?? 0)

      // Inbox count
      const inboxReader = await connection.runAndReadAll(
        `SELECT COUNT(DISTINCT inbox_id) as count FROM conversations`
      )
      const inboxRows = inboxReader.getRowObjectsJS() as Array<{
        count: bigint | number
      }>
      const inboxCount = Number(inboxRows[0]?.count ?? 0)

      // Date range
      const dateReader = await connection.runAndReadAll(
        `SELECT MIN(last_message_at) as oldest, MAX(last_message_at) as newest FROM conversations`
      )
      const dateRows = dateReader.getRowObjectsJS() as Array<{
        oldest: Date | string | null
        newest: Date | string | null
      }>
      const dateRange = {
        oldest: toJSDate(dateRows[0]?.oldest),
        newest: toJSDate(dateRows[0]?.newest),
      }

      return {
        totalConversations,
        filteredConversations,
        totalMessages,
        inboxCount,
        dateRange,
      }
    },

    async close(): Promise<void> {
      connection.closeSync()
    },
  }
}

/**
 * Get inbox IDs for an app slug.
 * Returns undefined if no mapping exists.
 */
export function getInboxIdsForApp(appSlug: string): string[] | undefined {
  return APP_TO_INBOX[appSlug]
}

/**
 * Get app slug for an inbox ID.
 * Returns undefined if no mapping exists.
 */
export function getAppForInbox(inboxId: string): string | undefined {
  return INBOX_TO_APP[inboxId]
}
