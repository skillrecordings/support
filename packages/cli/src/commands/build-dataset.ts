/**
 * Build eval dataset from real agent responses
 *
 * Pulls trigger messages and agent responses from Front + DB
 * to create labeled datasets for eval improvement.
 *
 * Usage:
 *   skill dataset build --since 2025-01-01 --output /tmp/dataset.json
 *   skill dataset build --app total-typescript --labeled-only
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
} from '@skillrecordings/database'
import { type Message } from '@skillrecordings/front-sdk'
import type { Command } from 'commander'
import { type CommandContext, createContext } from '../core/context'
import { CLIError, formatError } from '../core/errors'

interface EvalDataPoint {
  id: string
  app: string
  conversationId: string
  customerEmail: string
  triggerMessage: {
    subject: string
    body: string
    timestamp: number
  }
  agentResponse: {
    text: string
    category: string
    timestamp: string
  }
  label?: 'good' | 'bad'
  labeledBy?: string
  conversationHistory?: Array<{
    direction: 'in' | 'out'
    body: string
    timestamp: number
    author?: string
  }>
}

/**
 * Build eval dataset from responses
 */
export async function buildDataset(options: {
  ctx: CommandContext
  app?: string
  since?: string
  output?: string
  labeledOnly?: boolean
  limit?: number
  includeHistory?: boolean
}): Promise<void> {
  const { ctx } = options
  const outputJson = ctx.format === 'json'
  const db = getDb()
  const limit = options.limit || 100

  // Get Front token
  const frontToken = process.env.FRONT_API_TOKEN
  if (!frontToken) {
    throw new CLIError({
      userMessage: 'FRONT_API_TOKEN environment variable required.',
      suggestion:
        'Set FRONT_API_TOKEN or source apps/front/.env.local before running.',
    })
  }

  const front = createInstrumentedFrontClient({ apiToken: frontToken })

  try {
    // Build query conditions
    const conditions = [eq(ActionsTable.type, 'draft-response')]

    if (options.app) {
      const appResults = await db
        .select()
        .from(AppsTable)
        .where(eq(AppsTable.slug, options.app))
        .limit(1)

      const foundApp = appResults[0]
      if (!foundApp) {
        ctx.output.error(`App not found: ${options.app}`)
        process.exitCode = 1
        return
      }
      conditions.push(eq(ActionsTable.app_id, foundApp.id))
    }

    if (options.since) {
      const sinceDate = new Date(options.since)
      conditions.push(gte(ActionsTable.created_at, sinceDate))
    }

    // Query actions
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

    if (!outputJson) {
      ctx.output.message(
        `Found ${results.length} responses, fetching context...`
      )
    }

    const dataset: EvalDataPoint[] = []
    let processed = 0

    for (const r of results) {
      processed++
      if (!outputJson) {
        ctx.output.progress(`Processing ${processed}/${results.length}...`)
      }

      const params = r.action.parameters as {
        response?: string
        category?: string
      }

      // Skip if no response
      if (!params.response) continue

      // Determine label
      let label: 'good' | 'bad' | undefined
      let labeledBy: string | undefined

      if (r.action.approved_by) {
        label = 'good'
        labeledBy = r.action.approved_by
      } else if (r.action.rejected_by) {
        label = 'bad'
        labeledBy = r.action.rejected_by
      }

      // Skip unlabeled if labeledOnly
      if (options.labeledOnly && !label) continue

      // Fetch conversation from Front
      if (!r.action.conversation_id) continue

      let triggerMessage: EvalDataPoint['triggerMessage'] | undefined
      let conversationHistory: EvalDataPoint['conversationHistory'] | undefined

      try {
        const messageList = (await front.conversations.listMessages(
          r.action.conversation_id
        )) as { _results?: Message[] }
        const messages = messageList._results ?? []

        // Find trigger message (most recent inbound before draft)
        const draftTime = r.action.created_at?.getTime() ?? Date.now()
        const inboundBefore = messages
          .filter((m) => m.is_inbound && m.created_at * 1000 < draftTime)
          .sort((a, b) => b.created_at - a.created_at)

        const trigger = inboundBefore[0]
        if (trigger) {
          triggerMessage = {
            subject: trigger.subject ?? '',
            body:
              trigger.text ??
              trigger.body
                ?.replace(/<[^>]*>/g, ' ')
                .replace(/\s+/g, ' ')
                .trim() ??
              '',
            timestamp: trigger.created_at,
          }
        }

        // Include history if requested
        if (options.includeHistory) {
          conversationHistory = messages.map((m) => ({
            direction: m.is_inbound ? ('in' as const) : ('out' as const),
            body:
              m.text ??
              m.body
                ?.replace(/<[^>]*>/g, ' ')
                .replace(/\s+/g, ' ')
                .trim() ??
              '',
            timestamp: m.created_at,
            author: m.author?.email,
          }))
        }
      } catch (err) {
        // Skip if can't fetch context
        continue
      }

      // Skip if no trigger message
      if (!triggerMessage) continue

      dataset.push({
        id: r.action.id,
        app: r.app?.slug ?? 'unknown',
        conversationId: r.action.conversation_id,
        customerEmail: r.conversation?.customer_email ?? 'unknown',
        triggerMessage,
        agentResponse: {
          text: params.response,
          category: params.category ?? 'unknown',
          timestamp: r.action.created_at?.toISOString() ?? '',
        },
        label,
        labeledBy,
        conversationHistory,
      })
    }

    if (outputJson) {
      if (options.output) {
        writeFileSync(options.output, JSON.stringify(dataset, null, 2), 'utf-8')
        ctx.output.data({ success: true, output: options.output })
      } else {
        ctx.output.data(dataset)
      }
      return
    }

    ctx.output.data(`\n\nBuilt dataset with ${dataset.length} eval points`)
    ctx.output.data(`  Labeled: ${dataset.filter((d) => d.label).length}`)
    ctx.output.data(
      `  Good: ${dataset.filter((d) => d.label === 'good').length}`
    )
    ctx.output.data(`  Bad: ${dataset.filter((d) => d.label === 'bad').length}`)
    ctx.output.data(`  Unlabeled: ${dataset.filter((d) => !d.label).length}`)

    const outputJsonText = JSON.stringify(dataset, null, 2)

    if (options.output) {
      writeFileSync(options.output, outputJsonText, 'utf-8')
      ctx.output.data(`\nSaved to ${options.output}`)
    } else {
      ctx.output.data('\n' + outputJsonText)
    }
  } catch (error) {
    const cliError =
      error instanceof CLIError
        ? error
        : new CLIError({
            userMessage: 'Failed to build dataset.',
            suggestion: 'Verify database and Front API access.',
            cause: error,
          })
    ctx.output.error(formatError(cliError))
    process.exitCode = cliError.exitCode
  }
}

/**
 * Convert dataset to evalite format
 */
export async function toEvalite(options: {
  ctx: CommandContext
  input: string
  output?: string
}): Promise<void> {
  const { readFileSync } = await import('fs')
  const { ctx } = options
  const outputJson = ctx.format === 'json'

  const data = JSON.parse(
    readFileSync(options.input, 'utf-8')
  ) as EvalDataPoint[]

  const evaliteData = data.map((d) => ({
    input: d.triggerMessage.body,
    output: d.agentResponse.text,
    expected: d.label === 'good' ? d.agentResponse.text : '',
    metadata: {
      id: d.id,
      app: d.app,
      category: d.agentResponse.category,
      label: d.label,
      subject: d.triggerMessage.subject,
    },
  }))

  const outputJsonText = JSON.stringify(evaliteData, null, 2)

  if (options.output) {
    writeFileSync(options.output, outputJsonText, 'utf-8')
    if (outputJson) {
      ctx.output.data({
        success: true,
        output: options.output,
        count: evaliteData.length,
      })
    } else {
      ctx.output.data(
        `Converted ${evaliteData.length} points to evalite format: ${options.output}`
      )
    }
    return
  }

  if (outputJson) {
    ctx.output.data(evaliteData)
  } else {
    ctx.output.data(outputJsonText)
  }
}

/**
 * Register dataset commands
 */
export function registerDatasetCommands(program: Command): void {
  const dataset = program
    .command('dataset')
    .description('Build and manage eval datasets')

  dataset
    .command('build')
    .description('Build eval dataset from agent responses')
    .option('-a, --app <slug>', 'Filter by app slug')
    .option('-s, --since <date>', 'Filter responses since date (YYYY-MM-DD)')
    .option('-o, --output <file>', 'Output file path')
    .option('-l, --limit <n>', 'Max responses to process', parseInt)
    .option('--labeled-only', 'Only include labeled responses')
    .option('--include-history', 'Include full conversation history')
    .option('--json', 'Output as JSON')
    .action(async (options, command) => {
      const ctx = await createContext({
        format:
          options.json === true
            ? 'json'
            : typeof command.optsWithGlobals === 'function'
              ? command.optsWithGlobals().format
              : command.parent?.opts().format,
        verbose:
          typeof command.optsWithGlobals === 'function'
            ? command.optsWithGlobals().verbose
            : command.parent?.opts().verbose,
        quiet:
          typeof command.optsWithGlobals === 'function'
            ? command.optsWithGlobals().quiet
            : command.parent?.opts().quiet,
      })
      await buildDataset({ ctx, ...options })
    })

  dataset
    .command('to-evalite')
    .description('Convert dataset to evalite format')
    .requiredOption('-i, --input <file>', 'Input dataset JSON file')
    .option('-o, --output <file>', 'Output file path')
    .option('--json', 'Output as JSON')
    .action(async (options, command) => {
      const ctx = await createContext({
        format:
          options.json === true
            ? 'json'
            : typeof command.optsWithGlobals === 'function'
              ? command.optsWithGlobals().format
              : command.parent?.opts().format,
        verbose:
          typeof command.optsWithGlobals === 'function'
            ? command.optsWithGlobals().verbose
            : command.parent?.opts().verbose,
        quiet:
          typeof command.optsWithGlobals === 'function'
            ? command.optsWithGlobals().quiet
            : command.parent?.opts().quiet,
      })
      await toEvalite({ ctx, ...options })
    })
}
