/**
 * Triage command - categorize conversations as actionable vs noise
 *
 * Usage:
 *   skill front triage --inbox <inbox-id>
 *   skill front triage --inbox <inbox-id> --status unassigned
 *   skill front triage --inbox <inbox-id> --auto-archive
 *   skill front triage --inbox <inbox-id> --json
 */

import type {
  Conversation,
  ConversationList,
  Message,
  MessageList,
} from '@skillrecordings/front-sdk'
import { generateObject } from 'ai'
import type { Command } from 'commander'
import { z } from 'zod'
import { type CommandContext, createContext } from '../../core/context'
import { CLIError, formatError } from '../../core/errors'
import { getFrontClient } from './client'
import { hateoasWrap, triageActions } from './hateoas'

interface TriageOptions {
  inbox: string
  status?: 'unassigned' | 'assigned' | 'archived'
  autoArchive?: boolean
  dryRun?: boolean
  json?: boolean
}

type Category = 'actionable' | 'noise' | 'spam'
type Urgency = 'low' | 'medium' | 'high'

interface TriageResult {
  id: string
  subject: string
  senderEmail: string
  senderName?: string
  category: Category
  reason: string
  created_at: number
  llm?: {
    urgency: Urgency
    category: string
    suggested_action: string
  } | null
}

interface CategoryStats {
  actionable: number
  noise: number
  spam: number
}

const LLM_MODEL = 'anthropic/claude-haiku-4-5'

const llmTriageSchema = z.object({
  urgency: z.enum(['low', 'medium', 'high']),
  category: z.string(),
  suggested_action: z.string(),
})

function normalizeMessageBody(message: Message | null): string {
  if (!message) return ''
  const rawBody = message.text || message.body || ''
  if (!rawBody) return ''
  return rawBody
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function buildLlmPrompt(
  conversation: Conversation,
  messageBody: string
): string {
  const subject = conversation.subject || '(no subject)'
  const senderEmail = conversation.recipient?.handle || 'unknown'
  const senderName = conversation.recipient?.name || 'unknown'
  const tags =
    conversation.tags && conversation.tags.length > 0
      ? conversation.tags.map((t) => t.name).join(', ')
      : 'none'
  const messageSection = messageBody
    ? `\nLatest inbound message:\n${messageBody}\n`
    : '\nLatest inbound message: (not available)\n'

  return `Classify this support conversation for triage.

Subject: ${subject}
Sender: ${senderName} <${senderEmail}>
Tags: ${tags}
${messageSection}

Return urgency (low/medium/high), a short category label, and a suggested next action.`
}

async function classifyWithLlm(
  conversation: Conversation,
  message: Message | null
): Promise<{
  urgency: Urgency
  category: string
  suggested_action: string
} | null> {
  try {
    const { object } = await generateObject({
      model: LLM_MODEL,
      schema: llmTriageSchema,
      prompt: buildLlmPrompt(conversation, normalizeMessageBody(message)),
    })
    return object
  } catch {
    return null
  }
}

/**
 * Categorize a conversation using heuristics
 */
function categorizeConversation(conversation: Conversation): {
  category: Category
  reason: string
} {
  const subject = (conversation.subject || '').toLowerCase()
  const senderEmail = conversation.recipient?.handle?.toLowerCase() || 'unknown'

  // Noise patterns (auto-generated emails)
  if (
    senderEmail.includes('mailer-daemon') ||
    senderEmail.includes('postmaster') ||
    senderEmail.includes('noreply') ||
    senderEmail.includes('no-reply')
  ) {
    return { category: 'noise', reason: 'System email address' }
  }

  if (senderEmail.includes('newsletter')) {
    return { category: 'noise', reason: 'Newsletter sender' }
  }

  if (
    subject.includes('delivery status') ||
    subject.includes('mail delivery failed') ||
    subject.includes('undelivered mail') ||
    subject.includes('returned mail')
  ) {
    return { category: 'noise', reason: 'Delivery failure notification' }
  }

  if (
    subject.includes('daily report') ||
    subject.includes('weekly report') ||
    subject.includes('monthly report')
  ) {
    return { category: 'noise', reason: 'Automated report' }
  }

  if (
    subject.includes('saml certificate') ||
    subject.includes('certificate expiring')
  ) {
    return { category: 'noise', reason: 'Certificate notification' }
  }

  if (
    subject.includes('automatic reply') ||
    subject.includes('out of office')
  ) {
    return { category: 'noise', reason: 'Auto-reply' }
  }

  // Spam patterns
  if (
    subject.includes('partnership') ||
    subject.includes('sponsorship') ||
    subject.includes('collaborate') ||
    subject.includes('collaboration opportunity')
  ) {
    return { category: 'spam', reason: 'Partnership pitch' }
  }

  if (
    subject.includes('guest post') ||
    subject.includes('link exchange') ||
    subject.includes('backlink')
  ) {
    return { category: 'spam', reason: 'SEO spam' }
  }

  if (
    subject.includes('promote your') ||
    subject.includes('marketing opportunity')
  ) {
    return { category: 'spam', reason: 'Marketing pitch' }
  }

  // Default: actionable
  return { category: 'actionable', reason: 'Real support issue' }
}

/**
 * Format timestamp to human-readable
 */
function formatTimestamp(ts: number): string {
  return new Date(ts * 1000).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

async function fetchLatestInboundMessage(
  front: ReturnType<typeof getFrontClient>,
  conversationId: string
): Promise<Message | null> {
  try {
    const messageList = (await front.conversations.listMessages(
      conversationId
    )) as MessageList
    const messages = messageList._results ?? []
    const latestInbound = messages
      .filter((message) => message.is_inbound)
      .sort((a, b) => b.created_at - a.created_at)[0]

    if (!latestInbound) return null

    try {
      const fullMessage = (await front.messages.get(
        latestInbound.id
      )) as Message
      return fullMessage
    } catch {
      return latestInbound
    }
  } catch {
    return null
  }
}

/**
 * Main triage function
 */
export async function triageConversations(
  ctx: CommandContext,
  options: TriageOptions
): Promise<void> {
  const { inbox, status = 'unassigned', autoArchive = false, dryRun } = options
  const outputJson = options.json === true || ctx.format === 'json'

  try {
    const front = getFrontClient()

    if (!outputJson) {
      ctx.output.data(
        `\nFetching ${status} conversations from inbox ${inbox}...`
      )
    }

    // Build query URL
    let queryUrl = `/inboxes/${inbox}/conversations?limit=50&q[statuses][]=${status}`

    // Fetch conversations
    const allConversations: Conversation[] = []
    let nextUrl: string | null = queryUrl

    while (nextUrl) {
      const data = (await front.raw.get(nextUrl)) as ConversationList
      allConversations.push(...(data._results || []))

      if (!outputJson) {
        ctx.output.progress(
          `Fetched ${allConversations.length} conversations to triage`
        )
      }

      nextUrl = data._pagination?.next || null
    }

    if (!outputJson) {
      ctx.output.data(`\n  Total: ${allConversations.length} conversations\n`)
    }

    // Categorize each conversation
    const results: TriageResult[] = []
    const stats: CategoryStats = { actionable: 0, noise: 0, spam: 0 }

    for (const conv of allConversations) {
      const { category, reason } = categorizeConversation(conv)
      const latestMessage = await fetchLatestInboundMessage(front, conv.id)
      const llm = await classifyWithLlm(conv, latestMessage)
      stats[category]++

      results.push({
        id: conv.id,
        subject: conv.subject || '(no subject)',
        senderEmail: conv.recipient?.handle || 'unknown',
        senderName: conv.recipient?.name || undefined,
        category,
        reason,
        created_at: conv.created_at,
        llm,
      })
    }

    // Output results
    if (outputJson) {
      ctx.output.data(
        hateoasWrap({
          type: 'triage-result',
          command: `skill front triage --inbox ${inbox} --json`,
          data: {
            total: allConversations.length,
            stats,
            results,
          },
          actions: triageActions(inbox),
        })
      )
      return
    }

    // Human-readable output
    ctx.output.data('📊 Triage Results:')
    ctx.output.data('-'.repeat(80))
    ctx.output.data(
      `   Actionable: ${stats.actionable} (${Math.round((stats.actionable / allConversations.length) * 100)}%)`
    )
    ctx.output.data(
      `   Noise:      ${stats.noise} (${Math.round((stats.noise / allConversations.length) * 100)}%)`
    )
    ctx.output.data(
      `   Spam:       ${stats.spam} (${Math.round((stats.spam / allConversations.length) * 100)}%)`
    )
    ctx.output.data('-'.repeat(80))
    ctx.output.data('')

    // Show by category
    const byCategory: Record<Category, TriageResult[]> = {
      actionable: [],
      noise: [],
      spam: [],
    }

    for (const result of results) {
      byCategory[result.category].push(result)
    }

    // Show actionable first
    if (byCategory.actionable.length > 0) {
      ctx.output.data(`✅ ACTIONABLE (${byCategory.actionable.length}):`)
      for (const r of byCategory.actionable
        .sort((a, b) => b.created_at - a.created_at)
        .slice(0, 10)) {
        ctx.output.data(`   ${r.id} - ${formatTimestamp(r.created_at)}`)
        ctx.output.data(`      From: ${r.senderEmail}`)
        ctx.output.data(`      Subject: ${r.subject}`)
        ctx.output.data(`      → ${r.reason}`)
        if (r.llm) {
          ctx.output.data(
            `      LLM: ${r.llm.urgency} · ${r.llm.category} · ${r.llm.suggested_action}`
          )
        }
        ctx.output.data('')
      }
      if (byCategory.actionable.length > 10) {
        ctx.output.data(
          `   ... and ${byCategory.actionable.length - 10} more\n`
        )
      }
    }

    // Show noise
    if (byCategory.noise.length > 0) {
      ctx.output.data(`🔇 NOISE (${byCategory.noise.length}):`)
      for (const r of byCategory.noise
        .sort((a, b) => b.created_at - a.created_at)
        .slice(0, 5)) {
        ctx.output.data(
          `   ${r.id} - ${r.senderEmail} - ${r.subject.slice(0, 60)}`
        )
        ctx.output.data(`      → ${r.reason}`)
        if (r.llm) {
          ctx.output.data(
            `      LLM: ${r.llm.urgency} · ${r.llm.category} · ${r.llm.suggested_action}`
          )
        }
      }
      if (byCategory.noise.length > 5) {
        ctx.output.data(`   ... and ${byCategory.noise.length - 5} more\n`)
      }
    }

    // Show spam
    if (byCategory.spam.length > 0) {
      ctx.output.data(`🗑️  SPAM (${byCategory.spam.length}):`)
      for (const r of byCategory.spam
        .sort((a, b) => b.created_at - a.created_at)
        .slice(0, 5)) {
        ctx.output.data(
          `   ${r.id} - ${r.senderEmail} - ${r.subject.slice(0, 60)}`
        )
        ctx.output.data(`      → ${r.reason}`)
        if (r.llm) {
          ctx.output.data(
            `      LLM: ${r.llm.urgency} · ${r.llm.category} · ${r.llm.suggested_action}`
          )
        }
      }
      if (byCategory.spam.length > 5) {
        ctx.output.data(`   ... and ${byCategory.spam.length - 5} more\n`)
      }
    }

    // Auto-archive if requested
    if (autoArchive) {
      const toArchive = [...byCategory.noise, ...byCategory.spam]
      if (toArchive.length === 0) {
        ctx.output.data('No noise or spam to archive.\n')
        return
      }

      if (dryRun) {
        ctx.output.data(
          `\n🧪 DRY RUN: Would archive ${toArchive.length} conversations:`
        )
        for (const item of toArchive) {
          ctx.output.data(`   - ${item.id}`)
        }
        ctx.output.data('')
        return
      }

      ctx.output.data(`\n📦 Archiving ${toArchive.length} conversations...`)

      let archived = 0
      for (const r of toArchive) {
        try {
          await front.conversations.update(r.id, { status: 'archived' })
          archived++
          ctx.output.progress(
            `Archived ${archived}/${toArchive.length} conversations`
          )
        } catch (err) {
          // Skip failures
          continue
        }
      }

      ctx.output.data(`\n✅ Archived ${archived} conversations\n`)
    } else if (byCategory.noise.length > 0 || byCategory.spam.length > 0) {
      ctx.output.data(
        `\n💡 Tip: Use --auto-archive to automatically archive noise/spam\n`
      )
    }
  } catch (error) {
    const cliError =
      error instanceof CLIError
        ? error
        : new CLIError({
            userMessage: 'Failed to triage Front conversations.',
            suggestion: 'Verify inbox ID and FRONT_API_TOKEN.',
            cause: error,
          })
    ctx.output.error(formatError(cliError))
    process.exitCode = cliError.exitCode
  }
}

/**
 * Register triage command
 */
export function registerTriageCommand(front: Command): void {
  front
    .command('triage')
    .description('Categorize inbox conversations as actionable, noise, or spam')
    .requiredOption('-i, --inbox <id>', 'Inbox ID to triage')
    .option(
      '-s, --status <status>',
      'Conversation status filter (unassigned, assigned, archived)',
      'unassigned'
    )
    .option('--auto-archive', 'Automatically archive noise and spam')
    .option('--dry-run', 'Preview auto-archive without making changes')
    .option('--json', 'JSON output')
    .action(async (options: TriageOptions, command: Command) => {
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
      await triageConversations(ctx, options)
    })
}
