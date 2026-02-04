/**
 * Front CLI assign command
 *
 * Assigns or unassigns a conversation to a teammate
 */

import { createInstrumentedFrontClient } from '@skillrecordings/core/front/instrumented-client'
import type { Command } from 'commander'
import { type CommandContext, createContext } from '../../core/context'
import { CLIError, formatError } from '../../core/errors'
import { conversationActions, conversationLinks, hateoasWrap } from './hateoas'

interface AssignOptions {
  to?: string
  unassign?: boolean
  dryRun?: boolean
  json?: boolean
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

function normalizeId(idOrUrl: string): string {
  return idOrUrl.startsWith('http') ? idOrUrl.split('/').pop()! : idOrUrl
}

export async function assignConversation(
  ctx: CommandContext,
  conversationId: string,
  options: AssignOptions
): Promise<void> {
  const outputJson = options.json === true || ctx.format === 'json'
  const dryRun = options.dryRun === true

  try {
    const normalizedId = normalizeId(conversationId)

    if (options.unassign && options.to) {
      throw new CLIError({
        userMessage: 'Choose either --unassign or --to, not both.',
        suggestion: 'Remove one of the options and try again.',
      })
    }

    if (!options.unassign && !options.to) {
      throw new CLIError({
        userMessage: 'Missing assignee.',
        suggestion: 'Use --to <teammate-id> or --unassign.',
      })
    }

    const front = getFrontClient()
    const assigneeId = options.unassign ? '' : options.to!

    if (!dryRun) {
      await front.conversations.updateAssignee(normalizedId, assigneeId)
    }

    const result = {
      id: normalizedId,
      action: options.unassign ? 'unassigned' : 'assigned',
      assigneeId: options.unassign ? null : assigneeId,
      dryRun,
      success: true,
    }

    if (outputJson) {
      ctx.output.data(
        hateoasWrap({
          type: 'assign-result',
          command: `skill front assign ${normalizedId} ${
            options.unassign ? '--unassign' : `--to ${options.to}`
          } --json`,
          data: result,
          links: conversationLinks(normalizedId),
          actions: conversationActions(normalizedId),
        })
      )
      return
    }

    const verb = options.unassign ? 'Unassigned' : 'Assigned'
    const target = options.unassign ? '' : ` to ${options.to}`

    ctx.output.data('')
    if (dryRun) {
      ctx.output.data(`🧪 DRY RUN: ${verb} ${normalizedId}${target}`)
    } else {
      ctx.output.data(`✅ ${verb} ${normalizedId}${target}`)
    }
    ctx.output.data('')
  } catch (error) {
    const cliError =
      error instanceof CLIError
        ? error
        : new CLIError({
            userMessage: 'Failed to assign conversation.',
            suggestion:
              'Verify conversation ID, teammate ID, and FRONT_API_TOKEN.',
            cause: error,
          })
    ctx.output.error(formatError(cliError))
    process.exitCode = cliError.exitCode
  }
}

export function registerAssignCommand(frontCommand: Command): void {
  frontCommand
    .command('assign')
    .description('Assign or unassign a conversation')
    .argument('<conversation-id>', 'Conversation ID (e.g., cnv_xxx)')
    .option('--to <teammate-id>', 'Assign to teammate ID (tea_xxx)')
    .option('--unassign', 'Remove assignee from conversation')
    .option('--dry-run', 'Preview without making changes')
    .option('--json', 'Output as JSON')
    .action(
      async (
        conversationId: string,
        options: AssignOptions,
        command: Command
      ) => {
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
        await assignConversation(ctx, conversationId, options)
      }
    )
}
