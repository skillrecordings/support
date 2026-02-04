/**
 * Pull conversations from Front for eval dataset
 *
 * Usage:
 *   skill front pull --inbox <inbox_id> --limit 100 --output data/front-conversations.json
 */

import { writeFileSync } from 'fs'
import type { Command } from 'commander'
import { type CommandContext, createContext } from '../../core/context'
import { CLIError, formatError } from '../../core/errors'
import { getFrontClient } from './client'
import { hateoasWrap } from './hateoas'

interface PullOptions {
  inbox?: string
  limit?: number
  output?: string
  filter?: string
  json?: boolean
}

interface FrontConversation {
  id: string
  subject: string
  status: string
  created_at: number
  last_message_at?: number
  tags: Array<{ id: string; name: string }>
  recipient?: { handle: string; name?: string }
  assignee?: { email: string }
}

interface FrontMessage {
  id: string
  type: string
  is_inbound: boolean
  created_at: number
  subject?: string
  body?: string
  text?: string
  author?: { email?: string; name?: string }
}

interface EvalSample {
  id: string
  conversationId: string
  subject: string
  customerEmail: string
  status: string
  tags: string[]
  triggerMessage: {
    id: string
    subject: string
    body: string
    timestamp: number
  }
  conversationHistory: Array<{
    direction: 'in' | 'out'
    body: string
    timestamp: number
    author?: string
  }>
  category: string // inferred from tags/content
}

export async function pullConversations(
  ctx: CommandContext,
  options: PullOptions
): Promise<void> {
  const { inbox, limit = 50, output, filter } = options
  const outputJson = options.json === true || ctx.format === 'json'

  try {
    const front = getFrontClient()
    // If no inbox specified, list available inboxes
    if (!inbox) {
      ctx.output.data('Fetching available inboxes...\n')
      const inboxesData = (await front.raw.get('/inboxes')) as {
        _results: Array<{ id: string; name: string; address?: string }>
      }

      ctx.output.data('Available inboxes:')
      for (const ib of inboxesData._results || []) {
        ctx.output.data(
          `  ${ib.id}: ${ib.name} (${ib.address || 'no address'})`
        )
      }
      ctx.output.data(
        '\nUse --inbox <id> to pull conversations from a specific inbox'
      )
      return
    }

    ctx.output.data(`Pulling conversations from inbox ${inbox}...`)

    // Get conversations from inbox
    let allConversations: FrontConversation[] = []
    let nextUrl: string | null = `/inboxes/${inbox}/conversations?limit=50`

    while (nextUrl && allConversations.length < limit) {
      const data = (await front.raw.get(nextUrl)) as {
        _results: FrontConversation[]
        _pagination?: { next?: string }
      }

      allConversations = allConversations.concat(data._results || [])
      nextUrl = data._pagination?.next || null

      ctx.output.progress(
        `Fetched ${allConversations.length} conversations from inbox`
      )
    }

    allConversations = allConversations.slice(0, limit)
    ctx.output.data(`\n  Total: ${allConversations.length} conversations`)

    // Filter if specified
    if (filter) {
      const filterLower = filter.toLowerCase()
      allConversations = allConversations.filter((c) => {
        const subject = (c.subject || '').toLowerCase()
        const tags = c.tags.map((t) => t.name.toLowerCase()).join(' ')
        return subject.includes(filterLower) || tags.includes(filterLower)
      })
      ctx.output.data(
        `  After filter "${filter}": ${allConversations.length} conversations`
      )
    }

    // Build eval samples
    ctx.output.data('\nFetching message details...')
    const samples: EvalSample[] = []
    let processed = 0

    const normalizeBody = (message: FrontMessage): string => {
      const rawBody = message.text || message.body || ''
      if (!rawBody) return ''
      return rawBody
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    }

    for (const conv of allConversations) {
      processed++
      ctx.output.progress(
        `Processing ${processed}/${allConversations.length} conversations`
      )

      try {
        // Get messages for this conversation
        const messagesData = (await front.raw.get(
          `/conversations/${conv.id}/messages`
        )) as { _results: FrontMessage[] }
        const messages = messagesData._results || []
        const hydratedMessages: FrontMessage[] = []

        for (const message of messages) {
          try {
            const fullMessage = (await front.messages.get(
              message.id
            )) as FrontMessage
            hydratedMessages.push(fullMessage)
          } catch {
            hydratedMessages.push(message)
          }
        }

        // Find the most recent inbound message as trigger
        const inboundMessages = hydratedMessages
          .filter((m) => m.is_inbound)
          .sort((a, b) => b.created_at - a.created_at)

        const triggerMessage = inboundMessages[0]
        if (!triggerMessage) continue // Skip if no inbound messages

        // Extract body text
        const bodyText = normalizeBody(triggerMessage)

        // Skip very short messages
        if (bodyText.length < 20) continue

        // Build conversation history
        const history = hydratedMessages
          .sort((a, b) => a.created_at - b.created_at)
          .map((m) => ({
            direction: (m.is_inbound ? 'in' : 'out') as 'in' | 'out',
            body: normalizeBody(m),
            timestamp: m.created_at,
            author: m.author?.email,
          }))

        // Infer category from tags/subject
        const tagNames = conv.tags.map((t) => t.name.toLowerCase()).join(' ')
        const subject = (conv.subject || '').toLowerCase()
        let category = 'general'

        if (tagNames.includes('refund') || subject.includes('refund'))
          category = 'refund'
        else if (
          tagNames.includes('access') ||
          subject.includes('login') ||
          subject.includes('access')
        )
          category = 'access'
        else if (
          tagNames.includes('technical') ||
          subject.includes('error') ||
          subject.includes('bug')
        )
          category = 'technical'
        else if (subject.includes('feedback') || subject.includes('suggestion'))
          category = 'feedback'
        else if (
          subject.includes('partnership') ||
          subject.includes('collaborate')
        )
          category = 'business'

        samples.push({
          id: conv.id,
          conversationId: conv.id,
          subject: conv.subject || '(no subject)',
          customerEmail: conv.recipient?.handle || 'unknown',
          status: conv.status,
          tags: conv.tags.map((t) => t.name),
          triggerMessage: {
            id: triggerMessage.id,
            subject: triggerMessage.subject || conv.subject || '',
            body: bodyText,
            timestamp: triggerMessage.created_at,
          },
          conversationHistory: history,
          category,
        })

        // Rate limit
        await new Promise((r) => setTimeout(r, 100))
      } catch (err) {
        // Skip failed conversations
        continue
      }
    }

    ctx.output.data(`\n\nBuilt ${samples.length} eval samples`)

    // Category breakdown
    const byCategory: Record<string, number> = {}
    for (const s of samples) {
      byCategory[s.category] = (byCategory[s.category] || 0) + 1
    }
    ctx.output.data('\nBy category:')
    for (const [cat, count] of Object.entries(byCategory).sort(
      (a, b) => b[1] - a[1]
    )) {
      ctx.output.data(`  ${cat}: ${count}`)
    }

    // Output
    if (output) {
      writeFileSync(output, JSON.stringify(samples, null, 2))
      ctx.output.data(`\nSaved to ${output}`)
    } else if (outputJson) {
      ctx.output.data(
        hateoasWrap({
          type: 'eval-dataset',
          command: `skill front pull --inbox ${inbox} --json`,
          data: samples,
        })
      )
    }
  } catch (error) {
    const cliError =
      error instanceof CLIError
        ? error
        : new CLIError({
            userMessage: 'Failed to pull Front conversations.',
            suggestion: 'Verify inbox ID, filters, and FRONT_API_TOKEN.',
            cause: error,
          })
    ctx.output.error(formatError(cliError))
    process.exitCode = cliError.exitCode
  }
}

export function registerPullCommand(parent: Command): void {
  parent
    .command('pull')
    .description('Export conversations to JSON for eval datasets')
    .option('-i, --inbox <id>', 'Inbox ID to pull from')
    .option('-l, --limit <n>', 'Max conversations to pull', parseInt)
    .option('-o, --output <file>', 'Output file path')
    .option('-f, --filter <term>', 'Filter by subject/tag containing term')
    .option('--json', 'JSON output')
    .action(async (options: PullOptions, command: Command) => {
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
      await pullConversations(ctx, options)
    })
}
