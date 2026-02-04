/**
 * Front CLI conversation tag commands
 *
 * Adds or removes tags on a conversation (case-insensitive tag lookup)
 */

import type { Command } from 'commander'
import { type CommandContext, createContext } from '../../core/context'
import { CLIError, formatError } from '../../core/errors'
import { getFrontClient, normalizeId } from './client'
import { conversationActions, conversationLinks, hateoasWrap } from './hateoas'

interface TagOptions {
  tag?: string
  dryRun?: boolean
  json?: boolean
}

interface FrontTag {
  id: string
  name: string
}

async function fetchTags(front: ReturnType<typeof getFrontClient>) {
  const tags: FrontTag[] = []
  let nextUrl: string | null = '/tags'

  while (nextUrl) {
    const data = (await front.raw.get(nextUrl)) as {
      _results?: FrontTag[]
      _pagination?: { next?: string | null }
    }
    tags.push(...(data._results ?? []))
    nextUrl = data._pagination?.next ?? null
  }

  return tags
}

async function resolveTag(
  front: ReturnType<typeof getFrontClient>,
  tagName: string
): Promise<FrontTag> {
  const tags = await fetchTags(front)
  const normalized = tagName.toLowerCase()
  const matches = tags.filter((tag) => tag.name.toLowerCase() === normalized)

  if (matches.length === 0) {
    throw new CLIError({
      userMessage: `Tag not found: ${tagName}`,
      suggestion: 'Use `skill front tags list` to view available tags.',
    })
  }

  if (matches.length > 1) {
    throw new CLIError({
      userMessage: `Multiple tags matched: ${tagName}`,
      suggestion: 'Rename tags to unique names before retrying.',
    })
  }

  return matches[0]!
}

export async function tagConversation(
  ctx: CommandContext,
  conversationId: string,
  options: TagOptions
): Promise<void> {
  const outputJson = options.json === true || ctx.format === 'json'
  const dryRun = options.dryRun === true

  try {
    if (!options.tag) {
      throw new CLIError({
        userMessage: 'Tag name is required.',
        suggestion: 'Use --tag "<tag-name>".',
      })
    }

    const front = getFrontClient()
    const normalizedId = normalizeId(conversationId)
    const tag = await resolveTag(front, options.tag)

    if (!dryRun) {
      await front.conversations.addTag(normalizedId, tag.id)
    }

    const result = {
      id: normalizedId,
      action: 'tag',
      tag,
      dryRun,
      success: true,
    }

    if (outputJson) {
      ctx.output.data(
        hateoasWrap({
          type: 'tag-result',
          command: `skill front tag ${normalizedId} --tag "${options.tag}" --json`,
          data: result,
          links: conversationLinks(normalizedId),
          actions: conversationActions(normalizedId),
        })
      )
      return
    }

    ctx.output.data('')
    if (dryRun) {
      ctx.output.data(`🧪 DRY RUN: Tag ${normalizedId} with "${tag.name}"`)
    } else {
      ctx.output.data(`🏷️  Tagged ${normalizedId} with "${tag.name}"`)
    }
    ctx.output.data('')
  } catch (error) {
    const cliError =
      error instanceof CLIError
        ? error
        : new CLIError({
            userMessage: 'Failed to tag conversation.',
            suggestion:
              'Verify conversation ID, tag name, and FRONT_API_TOKEN.',
            cause: error,
          })
    ctx.output.error(formatError(cliError))
    process.exitCode = cliError.exitCode
  }
}

export async function untagConversation(
  ctx: CommandContext,
  conversationId: string,
  options: TagOptions
): Promise<void> {
  const outputJson = options.json === true || ctx.format === 'json'
  const dryRun = options.dryRun === true

  try {
    if (!options.tag) {
      throw new CLIError({
        userMessage: 'Tag name is required.',
        suggestion: 'Use --tag "<tag-name>".',
      })
    }

    const front = getFrontClient()
    const normalizedId = normalizeId(conversationId)
    const tag = await resolveTag(front, options.tag)

    if (!dryRun) {
      await front.conversations.removeTag(normalizedId, tag.id)
    }

    const result = {
      id: normalizedId,
      action: 'untag',
      tag,
      dryRun,
      success: true,
    }

    if (outputJson) {
      ctx.output.data(
        hateoasWrap({
          type: 'untag-result',
          command: `skill front untag ${normalizedId} --tag "${options.tag}" --json`,
          data: result,
          links: conversationLinks(normalizedId),
          actions: conversationActions(normalizedId),
        })
      )
      return
    }

    ctx.output.data('')
    if (dryRun) {
      ctx.output.data(`🧪 DRY RUN: Untag ${normalizedId} with "${tag.name}"`)
    } else {
      ctx.output.data(`🏷️  Removed tag "${tag.name}" from ${normalizedId}`)
    }
    ctx.output.data('')
  } catch (error) {
    const cliError =
      error instanceof CLIError
        ? error
        : new CLIError({
            userMessage: 'Failed to untag conversation.',
            suggestion:
              'Verify conversation ID, tag name, and FRONT_API_TOKEN.',
            cause: error,
          })
    ctx.output.error(formatError(cliError))
    process.exitCode = cliError.exitCode
  }
}

export function registerConversationTagCommands(frontCommand: Command): void {
  frontCommand
    .command('tag')
    .description('Add a tag to a conversation')
    .argument('<conversation-id>', 'Conversation ID (e.g., cnv_xxx)')
    .option('--tag <tag-name>', 'Tag name (case-insensitive)')
    .option('--dry-run', 'Preview without making changes')
    .option('--json', 'Output as JSON')
    .action(
      async (conversationId: string, options: TagOptions, command: Command) => {
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
        await tagConversation(ctx, conversationId, options)
      }
    )

  frontCommand
    .command('untag')
    .description('Remove a tag from a conversation')
    .argument('<conversation-id>', 'Conversation ID (e.g., cnv_xxx)')
    .option('--tag <tag-name>', 'Tag name (case-insensitive)')
    .option('--dry-run', 'Preview without making changes')
    .option('--json', 'Output as JSON')
    .action(
      async (conversationId: string, options: TagOptions, command: Command) => {
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
        await untagConversation(ctx, conversationId, options)
      }
    )
}
