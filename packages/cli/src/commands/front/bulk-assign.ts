/**
 * Front CLI bulk-assign command
 *
 * Assigns conversations matching a Front search filter in an inbox
 */

import { createInstrumentedFrontClient } from '@skillrecordings/core/front/instrumented-client'
import type { Command } from 'commander'
import { type CommandContext, createContext } from '../../core/context'
import { CLIError, formatError } from '../../core/errors'
import {
  conversationListActions,
  conversationListLinks,
  hateoasWrap,
} from './hateoas'

interface BulkAssignOptions {
  inbox?: string
  filter?: string
  to?: string
  dryRun?: boolean
  json?: boolean
}

interface FrontConversation {
  id: string
  subject?: string
  status?: string
  assignee?: { id?: string; email?: string } | null
}

function requireFrontToken(): string {
  const apiToken = process.env.FRONT_API_TOKEN
  if (!apiToken) {
    throw new CLIError({
      userMessage: 'FRONT_API_TOKEN environment variable is required.',
      suggestion: 'Set FRONT_API_TOKEN in your shell or .env.local.',
    })
  }
  return apiToken
}

function getFrontClient() {
  return createInstrumentedFrontClient({ apiToken: requireFrontToken() })
}

export async function bulkAssignConversations(
  ctx: CommandContext,
  options: BulkAssignOptions
): Promise<void> {
  const outputJson = options.json === true || ctx.format === 'json'
  const dryRun = options.dryRun === true

  try {
    if (!options.inbox) {
      throw new CLIError({
        userMessage: 'Inbox ID is required.',
        suggestion: 'Use --inbox <inbox-id>.',
      })
    }
    if (!options.filter) {
      throw new CLIError({
        userMessage: 'Filter query is required.',
        suggestion: 'Use --filter "<query>".',
      })
    }
    if (!options.to) {
      throw new CLIError({
        userMessage: 'Assignee is required.',
        suggestion: 'Use --to <teammate-id>.',
      })
    }

    const front = getFrontClient()
    const query = encodeURIComponent(options.filter)

    if (!outputJson) {
      ctx.output.data(
        `Fetching conversations from inbox ${options.inbox} using filter: ${options.filter}`
      )
      if (dryRun) {
        ctx.output.data('(DRY RUN - no changes will be made)\n')
      }
    }

    const conversations: FrontConversation[] = []
    let nextUrl: string | null =
      `/inboxes/${options.inbox}/conversations?limit=50&q=${query}`

    while (nextUrl) {
      const data = (await front.raw.get(nextUrl)) as {
        _results?: FrontConversation[]
        _pagination?: { next?: string | null }
      }
      conversations.push(...(data._results ?? []))

      if (!outputJson) {
        ctx.output.progress(`Fetched ${conversations.length} conversations`)
      }

      nextUrl = data._pagination?.next ?? null
    }

    if (!outputJson) {
      ctx.output.data(`\nTotal matches: ${conversations.length}`)
    }

    if (conversations.length === 0) {
      if (outputJson) {
        ctx.output.data(
          hateoasWrap({
            type: 'bulk-assign-result',
            command: `skill front bulk-assign --inbox ${options.inbox} --filter "${options.filter}" --to ${options.to} --json`,
            data: {
              inbox: options.inbox,
              filter: options.filter,
              assigneeId: options.to,
              dryRun,
              total: 0,
              assigned: 0,
              failed: 0,
              results: [],
            },
            actions: conversationListActions(options.inbox),
          })
        )
      }
      return
    }

    const results: Array<{
      id: string
      subject?: string
      status?: string
      assigned: boolean
      error?: string
    }> = []

    let assigned = 0
    let failed = 0

    for (const conv of conversations) {
      if (dryRun) {
        results.push({
          id: conv.id,
          subject: conv.subject,
          status: conv.status,
          assigned: true,
        })
        continue
      }

      try {
        await front.conversations.updateAssignee(conv.id, options.to)
        assigned += 1
        results.push({
          id: conv.id,
          subject: conv.subject,
          status: conv.status,
          assigned: true,
        })
        if (!outputJson) {
          ctx.output.data(`   ✅ Assigned ${conv.id}`)
        }
      } catch (error) {
        failed += 1
        const message = error instanceof Error ? error.message : 'Unknown error'
        results.push({
          id: conv.id,
          subject: conv.subject,
          status: conv.status,
          assigned: false,
          error: message,
        })
        if (!outputJson) {
          ctx.output.data(`   ❌ Failed ${conv.id}: ${message}`)
        }
      }
    }

    if (dryRun) {
      assigned = conversations.length
    }

    if (outputJson) {
      ctx.output.data(
        hateoasWrap({
          type: 'bulk-assign-result',
          command: `skill front bulk-assign --inbox ${options.inbox} --filter "${options.filter}" --to ${options.to} --json`,
          data: {
            inbox: options.inbox,
            filter: options.filter,
            assigneeId: options.to,
            dryRun,
            total: conversations.length,
            assigned,
            failed,
            results,
          },
          links: conversationListLinks(
            conversations.map((c) => ({ id: c.id, subject: c.subject })),
            options.inbox
          ),
          actions: conversationListActions(options.inbox),
        })
      )
      return
    }

    if (!dryRun) {
      ctx.output.data('')
      ctx.output.data('📊 Summary:')
      ctx.output.data(`   ✅ Assigned: ${assigned}`)
      if (failed > 0) {
        ctx.output.data(`   ❌ Failed: ${failed}`)
      }
      ctx.output.data('')
    } else {
      ctx.output.data(
        `\nRun without --dry-run to assign ${conversations.length} conversation(s).\n`
      )
    }

    if (failed > 0) {
      const cliError = new CLIError({
        userMessage: 'One or more conversations failed to assign.',
        suggestion: 'Review the output above for failed IDs.',
      })
      ctx.output.error(formatError(cliError))
      process.exitCode = cliError.exitCode
    }
  } catch (error) {
    const cliError =
      error instanceof CLIError
        ? error
        : new CLIError({
            userMessage: 'Failed to bulk assign conversations.',
            suggestion: 'Verify inbox, filter, assignee, and FRONT_API_TOKEN.',
            cause: error,
          })
    ctx.output.error(formatError(cliError))
    process.exitCode = cliError.exitCode
  }
}

export function registerBulkAssignCommand(frontCommand: Command): void {
  frontCommand
    .command('bulk-assign')
    .description('Bulk assign conversations matching a filter in an inbox')
    .option('-i, --inbox <inbox-id>', 'Inbox ID (inb_xxx)')
    .option('--filter <query>', 'Front search query filter')
    .option('--to <teammate-id>', 'Assignee teammate ID (tea_xxx)')
    .option('--dry-run', 'Preview without making changes')
    .option('--json', 'Output as JSON')
    .action(async (options: BulkAssignOptions, command: Command) => {
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
      await bulkAssignConversations(ctx, options)
    })
}
