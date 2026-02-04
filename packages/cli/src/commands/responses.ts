/**
 * CLI commands for pulling agent responses for analysis
 *
 * Usage:
 *   skill responses list --app total-typescript --limit 50
 *   skill responses list --since 2024-01-01 --json
 *   skill responses get <actionId> --context
 */

import { writeFileSync } from 'fs'
import { createInstrumentedFrontClient } from '@skillrecordings/core/front/instrumented-client'
import {
  ActionsTable,
  AppsTable,
  ConversationsTable,
  and,
  desc,
  eq,
  getDb,
  gte,
  or,
} from '@skillrecordings/database'
import { type Message } from '@skillrecordings/front-sdk'
import type { Command } from 'commander'
import { type CommandContext, createContext } from '../core/context'
import { CLIError, formatError } from '../core/errors'

type ActionRow = typeof ActionsTable.$inferSelect

interface ResponseRecord {
  actionId: string
  appSlug: string
  appName: string
  conversationId: string
  customerEmail: string
  customerName?: string
  customerDisplay: string
  response: string
  category: string
  createdAt: Date
  rating?: 'good' | 'bad'
  ratedBy?: string
  ratedAt?: Date
}

interface ResponseWithContext extends ResponseRecord {
  conversationHistory?: Array<{
    id: string
    isInbound: boolean
    body: string
    createdAt: number
    author?: string
  }>
  triggerMessage?: {
    subject: string
    body: string
  }
}

/**
 * Format timestamp for display
 */
function formatDate(date: Date): string {
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Truncate string with ellipsis
 */
function truncate(str: string, len: number): string {
  if (!str) return ''
  if (str.length <= len) return str
  return str.slice(0, len - 3) + '...'
}

function normalizeParams(raw: unknown): Record<string, unknown> {
  if (typeof raw === 'string') {
    try {
      let parsed: unknown = JSON.parse(raw)
      if (typeof parsed === 'string') {
        try {
          parsed = JSON.parse(parsed)
        } catch {
          return {}
        }
      }
      if (parsed && typeof parsed === 'object')
        return parsed as Record<string, unknown>
    } catch {
      return {}
    }
  }

  if (raw && typeof raw === 'object') {
    if (raw instanceof Uint8Array) {
      const text = Buffer.from(raw).toString('utf-8')
      return normalizeParams(text)
    }
    return raw as Record<string, unknown>
  }

  return {}
}

function normalizeNested(value: unknown): Record<string, unknown> | undefined {
  if (!value) return undefined
  if (typeof value === 'string' || value instanceof Uint8Array) {
    const normalized = normalizeParams(value)
    return Object.keys(normalized).length ? normalized : undefined
  }
  if (typeof value === 'object') {
    return value as Record<string, unknown>
  }
  return undefined
}

function extractText(value: unknown): string {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const content = record.content
    if (typeof content === 'string') return content
    const text = record.text
    if (typeof text === 'string') return text
    const body = record.body
    if (typeof body === 'string') return body
    const html = record.html
    if (typeof html === 'string') return html
  }
  return ''
}

function getResponseText(params: Record<string, unknown>): string {
  return (
    extractText(params.response) ||
    extractText(params.draft) ||
    extractText(params.responseText) ||
    extractText(params.draftText) ||
    ''
  )
}

function getCategory(
  actionCategory: string | null,
  params: Record<string, unknown>
): string {
  const context = normalizeNested(params.context)
  const category = params.category ?? context?.category
  return (
    actionCategory ??
    (typeof category === 'string' ? category : undefined) ??
    'unknown'
  )
}

function getCustomerEmail(
  conversationEmail: string | null | undefined,
  params: Record<string, unknown>
): string {
  const context = normalizeNested(params.context)
  const gatheredContext = normalizeNested(params.gatheredContext)
  const customer =
    (context?.customer as Record<string, unknown> | undefined) ??
    (gatheredContext?.customer as Record<string, unknown> | undefined) ??
    (params.customer as Record<string, unknown> | undefined)

  const candidate =
    conversationEmail ??
    (typeof context?.customerEmail === 'string'
      ? context.customerEmail
      : undefined) ??
    (typeof params.customerEmail === 'string'
      ? params.customerEmail
      : undefined) ??
    (typeof customer?.email === 'string' ? customer.email : undefined) ??
    (typeof params.senderEmail === 'string' ? params.senderEmail : undefined) ??
    (typeof (params as Record<string, unknown>).sender_email === 'string'
      ? ((params as Record<string, unknown>).sender_email as string)
      : undefined) ??
    (typeof params.from === 'string' ? params.from : undefined)

  return candidate ?? 'unknown'
}

function getCustomerName(
  conversationName: string | null | undefined,
  params: Record<string, unknown>
): string | undefined {
  const context = normalizeNested(params.context)
  const gatheredContext = normalizeNested(params.gatheredContext)
  const customer =
    (context?.customer as Record<string, unknown> | undefined) ??
    (gatheredContext?.customer as Record<string, unknown> | undefined) ??
    (params.customer as Record<string, unknown> | undefined)

  const candidate =
    conversationName ??
    (typeof params.customerName === 'string'
      ? params.customerName
      : undefined) ??
    (typeof customer?.name === 'string' ? customer.name : undefined)

  return candidate
}

function formatCustomerDisplay(email: string, name?: string): string {
  if (name && email && email !== 'unknown') {
    return `${name} <${email}>`
  }
  return name ?? email ?? 'unknown'
}

const handleResponsesError = (
  ctx: CommandContext,
  error: unknown,
  message: string,
  suggestion = 'Verify inputs and try again.'
): void => {
  const cliError =
    error instanceof CLIError
      ? error
      : new CLIError({
          userMessage: message,
          suggestion,
          cause: error,
        })

  ctx.output.error(formatError(cliError))
  process.exitCode = cliError.exitCode
}

async function findResponseFallback(
  db: ReturnType<typeof getDb>,
  actionId: string,
  conversationId: string
): Promise<{ action: ActionRow; params: Record<string, unknown> } | null> {
  const candidates = await db
    .select()
    .from(ActionsTable)
    .where(eq(ActionsTable.conversation_id, conversationId))
    .orderBy(desc(ActionsTable.created_at))
    .limit(10)

  for (const candidate of candidates) {
    if (candidate.id === actionId) continue
    if (
      candidate.type !== 'send-draft' &&
      candidate.type !== 'draft-response'
    ) {
      continue
    }
    const params = normalizeParams(candidate.parameters)
    const responseText = getResponseText(params)
    if (responseText) {
      return { action: candidate, params }
    }
  }

  return null
}

/**
 * List recent agent responses
 */
export async function listResponses(
  ctx: CommandContext,
  options: {
    app?: string
    limit?: number
    since?: string
    rating?: 'good' | 'bad' | 'unrated'
    json?: boolean
    idsOnly?: boolean
  }
): Promise<void> {
  const db = getDb()
  const limit = options.limit || 20
  const outputJson = options.json === true || ctx.format === 'json'
  const idsOnly = options.idsOnly === true && !outputJson

  try {
    // Build query conditions
    // Support both old 'draft-response' and new 'send-draft' action types
    const conditions = [
      or(
        eq(ActionsTable.type, 'send-draft'),
        eq(ActionsTable.type, 'draft-response')
      ),
    ]

    if (options.app) {
      // Lookup app by slug
      const appResults = await db
        .select()
        .from(AppsTable)
        .where(eq(AppsTable.slug, options.app))
        .limit(1)

      const foundApp = appResults[0]
      if (!foundApp) {
        throw new CLIError({
          userMessage: `App not found: ${options.app}.`,
          suggestion: 'Verify the app slug and try again.',
        })
      }
      conditions.push(eq(ActionsTable.app_id, foundApp.id))
    }

    if (options.since) {
      const sinceDate = new Date(options.since)
      conditions.push(gte(ActionsTable.created_at, sinceDate))
    }

    // Query actions with app and conversation info
    const results = await db
      .select({
        action: ActionsTable,
        app: AppsTable,
        conversation: ConversationsTable,
      })
      .from(ActionsTable)
      .leftJoin(AppsTable, eq(ActionsTable.app_id, AppsTable.id))
      .leftJoin(
        ConversationsTable,
        eq(
          ActionsTable.conversation_id,
          ConversationsTable.front_conversation_id
        )
      )
      .where(and(...conditions))
      .orderBy(desc(ActionsTable.created_at))
      .limit(limit)

    // Transform to response records
    const responses: ResponseRecord[] = []

    for (const r of results) {
      let params = normalizeParams(r.action.parameters)
      let responseText = getResponseText(params)
      let customerName = getCustomerName(r.conversation?.customer_name, params)
      let customerEmail = getCustomerEmail(
        r.conversation?.customer_email,
        params
      )

      if (
        (!responseText || customerEmail === 'unknown') &&
        r.action.conversation_id
      ) {
        const fallback = await findResponseFallback(
          db,
          r.action.id,
          r.action.conversation_id
        )
        if (fallback) {
          params = fallback.params
          responseText = responseText || getResponseText(params)
          customerName =
            customerName ??
            getCustomerName(r.conversation?.customer_name, params)
          if (customerEmail === 'unknown') {
            customerEmail = getCustomerEmail(
              r.conversation?.customer_email,
              params
            )
          }
        }
      }

      // Determine rating from approved_by/rejected_by
      let rating: 'good' | 'bad' | undefined
      let ratedBy: string | undefined
      let ratedAt: Date | undefined

      if (r.action.approved_by) {
        rating = 'good'
        ratedBy = r.action.approved_by
        ratedAt = r.action.approved_at ?? undefined
      } else if (r.action.rejected_by) {
        rating = 'bad'
        ratedBy = r.action.rejected_by
        ratedAt = r.action.rejected_at ?? undefined
      }

      responses.push({
        actionId: r.action.id,
        appSlug: r.app?.slug ?? 'unknown',
        appName: r.app?.name ?? 'Unknown App',
        conversationId: r.action.conversation_id ?? '',
        customerEmail,
        customerName,
        customerDisplay: formatCustomerDisplay(customerEmail, customerName),
        response: responseText,
        category: getCategory(r.action.category, params),
        createdAt: r.action.created_at ?? new Date(),
        rating,
        ratedBy,
        ratedAt,
      })
    }

    // Filter by rating if specified
    let filteredResponses = responses
    if (options.rating === 'good') {
      filteredResponses = responses.filter((r) => r.rating === 'good')
    } else if (options.rating === 'bad') {
      filteredResponses = responses.filter((r) => r.rating === 'bad')
    } else if (options.rating === 'unrated') {
      filteredResponses = responses.filter((r) => !r.rating)
    }

    if (outputJson) {
      ctx.output.data(filteredResponses)
      return
    }

    if (idsOnly) {
      for (const response of filteredResponses) {
        ctx.output.data(response.actionId)
      }
      return
    }

    // Display table
    ctx.output.data('\n📝 Agent Responses')
    ctx.output.data('='.repeat(80))

    for (const r of filteredResponses) {
      const ratingIcon =
        r.rating === 'good' ? '👍' : r.rating === 'bad' ? '👎' : '⏳'
      ctx.output.data(
        `\n${ratingIcon} [${formatDate(r.createdAt)}] ${r.appSlug}`
      )
      ctx.output.data(`   Customer: ${r.customerDisplay}`)
      ctx.output.data(`   Category: ${r.category}`)
      ctx.output.data(
        `   Response: ${truncate(r.response.replace(/\n/g, ' '), 200)}`
      )
      ctx.output.data(`   ID: ${r.actionId}`)
      if (r.rating) {
        ctx.output.data(`   Rated: ${r.rating} by ${r.ratedBy}`)
      }
    }

    ctx.output.data('\n' + '-'.repeat(80))
    ctx.output.data(`Total: ${filteredResponses.length} responses`)
    ctx.output.data(
      `  👍 Good: ${filteredResponses.filter((r) => r.rating === 'good').length}`
    )
    ctx.output.data(
      `  👎 Bad: ${filteredResponses.filter((r) => r.rating === 'bad').length}`
    )
    ctx.output.data(
      `  ⏳ Unrated: ${filteredResponses.filter((r) => !r.rating).length}`
    )
    ctx.output.data('')
  } catch (error) {
    handleResponsesError(ctx, error, 'Failed to list responses.')
  }
}

/**
 * Get a specific response with full context
 */
export async function getResponse(
  ctx: CommandContext,
  actionId: string,
  options: { context?: boolean; json?: boolean }
): Promise<void> {
  const db = getDb()
  const outputJson = options.json === true || ctx.format === 'json'

  try {
    // Fetch the action with related data
    const results = await db
      .select({
        action: ActionsTable,
        app: AppsTable,
        conversation: ConversationsTable,
      })
      .from(ActionsTable)
      .leftJoin(AppsTable, eq(ActionsTable.app_id, AppsTable.id))
      .leftJoin(
        ConversationsTable,
        eq(
          ActionsTable.conversation_id,
          ConversationsTable.front_conversation_id
        )
      )
      .where(eq(ActionsTable.id, actionId))
      .limit(1)

    const r = results[0]
    if (!r) {
      throw new CLIError({
        userMessage: `Response not found: ${actionId}.`,
        suggestion: 'Verify the response ID and try again.',
      })
    }

    let params = normalizeParams(r.action.parameters)
    let responseText = getResponseText(params)
    let customerName = getCustomerName(r.conversation?.customer_name, params)
    let customerEmail = getCustomerEmail(r.conversation?.customer_email, params)

    if (
      (!responseText || customerEmail === 'unknown') &&
      r.action.conversation_id
    ) {
      const fallback = await findResponseFallback(
        db,
        r.action.id,
        r.action.conversation_id
      )
      if (fallback) {
        params = fallback.params
        responseText = responseText || getResponseText(params)
        customerName =
          customerName ?? getCustomerName(r.conversation?.customer_name, params)
        if (customerEmail === 'unknown') {
          customerEmail = getCustomerEmail(
            r.conversation?.customer_email,
            params
          )
        }
      }
    }

    let rating: 'good' | 'bad' | undefined
    let ratedBy: string | undefined
    let ratedAt: Date | undefined

    if (r.action.approved_by) {
      rating = 'good'
      ratedBy = r.action.approved_by
      ratedAt = r.action.approved_at ?? undefined
    } else if (r.action.rejected_by) {
      rating = 'bad'
      ratedBy = r.action.rejected_by
      ratedAt = r.action.rejected_at ?? undefined
    }

    const response: ResponseWithContext = {
      actionId: r.action.id,
      appSlug: r.app?.slug ?? 'unknown',
      appName: r.app?.name ?? 'Unknown App',
      conversationId: r.action.conversation_id ?? '',
      customerEmail,
      customerName,
      customerDisplay: formatCustomerDisplay(customerEmail, customerName),
      response: responseText,
      category: getCategory(r.action.category, params),
      createdAt: r.action.created_at ?? new Date(),
      rating,
      ratedBy,
      ratedAt,
    }

    // Fetch conversation context from Front if requested
    if (options.context && r.action.conversation_id) {
      const frontToken = process.env.FRONT_API_TOKEN
      if (frontToken) {
        try {
          const front = createInstrumentedFrontClient({ apiToken: frontToken })
          const messageList = (await front.conversations.listMessages(
            r.action.conversation_id
          )) as { _results?: Message[] }
          const messages = messageList._results ?? []

          response.conversationHistory = messages.map((m) => ({
            id: m.id,
            isInbound: m.is_inbound,
            body:
              m.text ||
              m.body
                .replace(/<[^>]*>/g, ' ')
                .replace(/\s+/g, ' ')
                .trim(),
            createdAt: m.created_at,
            author: m.author?.email,
          }))

          // Find the trigger message (most recent inbound before draft creation)
          const draftTime = r.action.created_at?.getTime() ?? Date.now()
          const inboundBefore = messages
            .filter((m) => m.is_inbound && m.created_at * 1000 < draftTime)
            .sort((a, b) => b.created_at - a.created_at)

          const trigger = inboundBefore[0]
          if (trigger) {
            response.triggerMessage = {
              subject: trigger.subject ?? '',
              body:
                trigger.text ??
                trigger.body
                  .replace(/<[^>]*>/g, ' ')
                  .replace(/\s+/g, ' ')
                  .trim(),
            }
          }
        } catch (err) {
          ctx.output.warn(
            `Failed to fetch Front context: ${err instanceof Error ? err.message : String(err)}`
          )
        }
      } else {
        ctx.output.warn('FRONT_API_TOKEN not set, skipping context fetch')
      }
    }

    if (outputJson) {
      ctx.output.data(response)
      return
    }

    // Display detailed view
    const ratingIcon =
      response.rating === 'good'
        ? '👍'
        : response.rating === 'bad'
          ? '👎'
          : '⏳'

    ctx.output.data('\n📝 Agent Response Details')
    ctx.output.data('='.repeat(80))
    ctx.output.data(`ID:         ${response.actionId}`)
    ctx.output.data(`App:        ${response.appName} (${response.appSlug})`)
    ctx.output.data(`Customer:   ${response.customerDisplay}`)
    ctx.output.data(`Category:   ${response.category}`)
    ctx.output.data(`Created:    ${formatDate(response.createdAt)}`)
    ctx.output.data(`Rating:     ${ratingIcon} ${response.rating ?? 'unrated'}`)
    if (response.ratedBy) {
      ctx.output.data(`Rated by:   ${response.ratedBy}`)
    }

    if (response.triggerMessage) {
      ctx.output.data('\n--- Trigger Message ---')
      if (response.triggerMessage.subject) {
        ctx.output.data(`Subject: ${response.triggerMessage.subject}`)
      }
      ctx.output.data(response.triggerMessage.body)
    }

    ctx.output.data('\n--- Agent Response ---')
    ctx.output.data(response.response)

    if (response.conversationHistory?.length) {
      ctx.output.data('\n--- Conversation History ---')
      for (const msg of response.conversationHistory) {
        const dir = msg.isInbound ? '← IN' : '→ OUT'
        const time = new Date(msg.createdAt * 1000).toLocaleString()
        ctx.output.data(`\n[${dir}] ${time} - ${msg.author ?? 'unknown'}`)
        ctx.output.data(truncate(msg.body, 500))
      }
    }

    ctx.output.data('')
  } catch (error) {
    handleResponsesError(ctx, error, 'Failed to fetch response.')
  }
}

/**
 * Export responses to a file for eval/analysis
 */
async function exportResponses(
  ctx: CommandContext,
  options: {
    app?: string
    since?: string
    output?: string
    rating?: 'good' | 'bad' | 'all'
  }
): Promise<void> {
  const db = getDb()
  const outputJsonFormat = ctx.format === 'json'

  try {
    // Build query conditions
    // Support both old 'draft-response' and new 'send-draft' action types
    const conditions = [
      or(
        eq(ActionsTable.type, 'send-draft'),
        eq(ActionsTable.type, 'draft-response')
      ),
    ]

    if (options.app) {
      const appResults = await db
        .select()
        .from(AppsTable)
        .where(eq(AppsTable.slug, options.app))
        .limit(1)

      const foundApp = appResults[0]
      if (!foundApp) {
        throw new CLIError({
          userMessage: `App not found: ${options.app}.`,
          suggestion: 'Verify the app slug and try again.',
        })
      }
      conditions.push(eq(ActionsTable.app_id, foundApp.id))
    }

    if (options.since) {
      const sinceDate = new Date(options.since)
      conditions.push(gte(ActionsTable.created_at, sinceDate))
    }

    // Query all matching actions
    const results = await db
      .select({
        action: ActionsTable,
        app: AppsTable,
        conversation: ConversationsTable,
      })
      .from(ActionsTable)
      .leftJoin(AppsTable, eq(ActionsTable.app_id, AppsTable.id))
      .leftJoin(
        ConversationsTable,
        eq(
          ActionsTable.conversation_id,
          ConversationsTable.front_conversation_id
        )
      )
      .where(and(...conditions))
      .orderBy(desc(ActionsTable.created_at))

    // Fetch Front context for each
    const frontToken = process.env.FRONT_API_TOKEN
    const front = frontToken
      ? createInstrumentedFrontClient({ apiToken: frontToken })
      : null

    const exportData: ResponseWithContext[] = []

    for (const r of results) {
      let params = normalizeParams(r.action.parameters)
      let responseText = getResponseText(params)
      let customerName = getCustomerName(r.conversation?.customer_name, params)
      let customerEmail = getCustomerEmail(
        r.conversation?.customer_email,
        params
      )

      if (
        (!responseText || customerEmail === 'unknown') &&
        r.action.conversation_id
      ) {
        const fallback = await findResponseFallback(
          db,
          r.action.id,
          r.action.conversation_id
        )
        if (fallback) {
          params = fallback.params
          responseText = responseText || getResponseText(params)
          customerName =
            customerName ??
            getCustomerName(r.conversation?.customer_name, params)
          if (customerEmail === 'unknown') {
            customerEmail = getCustomerEmail(
              r.conversation?.customer_email,
              params
            )
          }
        }
      }

      let rating: 'good' | 'bad' | undefined
      if (r.action.approved_by) rating = 'good'
      else if (r.action.rejected_by) rating = 'bad'

      // Filter by rating
      if (options.rating === 'good' && rating !== 'good') continue
      if (options.rating === 'bad' && rating !== 'bad') continue

      const record: ResponseWithContext = {
        actionId: r.action.id,
        appSlug: r.app?.slug ?? 'unknown',
        appName: r.app?.name ?? 'Unknown App',
        conversationId: r.action.conversation_id ?? '',
        customerEmail,
        customerName,
        customerDisplay: formatCustomerDisplay(customerEmail, customerName),
        response: responseText,
        category: getCategory(r.action.category, params),
        createdAt: r.action.created_at ?? new Date(),
        rating,
        ratedBy: r.action.approved_by ?? r.action.rejected_by ?? undefined,
        ratedAt: r.action.approved_at ?? r.action.rejected_at ?? undefined,
      }

      // Fetch context
      if (front && r.action.conversation_id) {
        try {
          const messageList = (await front.conversations.listMessages(
            r.action.conversation_id
          )) as { _results?: Message[] }
          const messages = messageList._results ?? []

          record.conversationHistory = messages.map((m) => ({
            id: m.id,
            isInbound: m.is_inbound,
            body:
              m.text ??
              m.body
                .replace(/<[^>]*>/g, ' ')
                .replace(/\s+/g, ' ')
                .trim(),
            createdAt: m.created_at,
            author: m.author?.email,
          }))

          const draftTime = r.action.created_at?.getTime() ?? Date.now()
          const inboundBefore = messages
            .filter((m) => m.is_inbound && m.created_at * 1000 < draftTime)
            .sort((a, b) => b.created_at - a.created_at)

          const trigger = inboundBefore[0]
          if (trigger) {
            record.triggerMessage = {
              subject: trigger.subject ?? '',
              body:
                trigger.text ??
                trigger.body
                  .replace(/<[^>]*>/g, ' ')
                  .replace(/\s+/g, ' ')
                  .trim(),
            }
          }
        } catch {
          // Skip context fetch failures
        }
      }

      exportData.push(record)
    }

    const outputJson = JSON.stringify(exportData, null, 2)

    if (options.output) {
      writeFileSync(options.output, outputJson, 'utf-8')
      if (!outputJsonFormat) {
        ctx.output.success(
          `Exported ${exportData.length} responses to ${options.output}`
        )
      }
    } else {
      ctx.output.data(exportData)
    }
  } catch (error) {
    handleResponsesError(ctx, error, 'Failed to export responses.')
  }
}

/**
 * Register response commands with Commander
 */
export function registerResponseCommands(program: Command): void {
  const responses = program
    .command('responses')
    .description('Pull agent responses for analysis')

  responses
    .command('list')
    .description('List recent agent responses')
    .option('-a, --app <slug>', 'Filter by app slug')
    .option('-l, --limit <n>', 'Number of responses (default: 20)', parseInt)
    .option('-s, --since <date>', 'Filter responses since date (YYYY-MM-DD)')
    .option('-r, --rating <type>', 'Filter by rating (good, bad, unrated)')
    .option('--ids-only', 'Output only IDs (one per line)')
    .option('--json', 'Output as JSON')
    .action(async (options: { json?: boolean; idsOnly?: boolean }, command) => {
      const opts =
        typeof command.optsWithGlobals === 'function'
          ? command.optsWithGlobals()
          : {
              ...command.parent?.opts(),
              ...command.opts(),
            }
      const ctx = await createContext({
        format: options.json ? 'json' : opts.format,
        verbose: opts.verbose,
        quiet: opts.quiet,
      })
      await listResponses(ctx, options)
    })

  responses
    .command('get')
    .description('Get a specific response with details')
    .argument('<actionId>', 'Action ID of the response')
    .option('-c, --context', 'Include conversation context from Front')
    .option('--json', 'Output as JSON')
    .action(async (actionId, options, command) => {
      const opts =
        typeof command.optsWithGlobals === 'function'
          ? command.optsWithGlobals()
          : {
              ...command.parent?.opts(),
              ...command.opts(),
            }
      const ctx = await createContext({
        format: options.json ? 'json' : opts.format,
        verbose: opts.verbose,
        quiet: opts.quiet,
      })
      await getResponse(ctx, actionId, options)
    })

  responses
    .command('export')
    .description('Export responses with context for analysis')
    .option('-a, --app <slug>', 'Filter by app slug')
    .option('-s, --since <date>', 'Filter responses since date (YYYY-MM-DD)')
    .option('-r, --rating <type>', 'Filter by rating (good, bad, all)')
    .option('-o, --output <file>', 'Output file path')
    .action(async (options, command) => {
      const opts =
        typeof command.optsWithGlobals === 'function'
          ? command.optsWithGlobals()
          : {
              ...command.parent?.opts(),
              ...command.opts(),
            }
      const ctx = await createContext({
        format: opts.format,
        verbose: opts.verbose,
        quiet: opts.quiet,
      })
      await exportResponses(ctx, options)
    })
}
