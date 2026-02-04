/**
 * CLI commands for testing agent tools against live app integrations.
 *
 * Usage:
 *   skill tools search <app-slug> <query>
 *   skill tools lookup <app-slug> <email>
 *   skill tools list
 */

import { AppsTable, eq, getDb } from '@skillrecordings/database'
import { IntegrationClient } from '@skillrecordings/sdk/client'
import type { Command } from 'commander'
import { type CommandContext, createContext } from '../core/context'
import { CLIError, formatError } from '../core/errors'

type AppConfig = {
  slug: string
  name: string
  baseUrl: string
  webhookSecret: string
  stripeAccountId: string | null
  instructorTeammateId: string | null
}

type AppConfigRow = {
  slug: string
  name: string
  baseUrl: string | null
  webhookSecret: string | null
  stripeAccountId: string | null
  instructorTeammateId: string | null
}

const CONTENT_TYPES = [
  'resource',
  'course',
  'module',
  'lesson',
  'article',
  'exercise',
  'social',
] as const

type ContentType = (typeof CONTENT_TYPES)[number]

const handleToolsError = (
  ctx: CommandContext,
  error: unknown,
  message: string,
  suggestion = 'Verify database access and integration settings.'
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

/**
 * Get app config from database by slug
 */
async function getAppConfig(slug: string): Promise<AppConfigRow | null> {
  const db = getDb()
  const results = await db
    .select()
    .from(AppsTable)
    .where(eq(AppsTable.slug, slug))
    .limit(1)

  const app = results[0]
  if (!app) {
    return null
  }

  // baseUrl should be the complete endpoint URL
  // SDK client will POST directly to this URL with action in body
  return {
    slug: app.slug,
    name: app.name,
    baseUrl: app.integration_base_url,
    webhookSecret: app.webhook_secret,
    stripeAccountId: app.stripe_account_id,
    instructorTeammateId: app.instructor_teammate_id,
  }
}

async function resolveAppConfig(slug: string): Promise<AppConfig> {
  const app = await getAppConfig(slug)
  if (!app) {
    throw new CLIError({
      userMessage: `App not found: ${slug}.`,
      suggestion: 'Use "skill tools list" to see registered apps.',
    })
  }

  if (!app.baseUrl || !app.webhookSecret) {
    throw new CLIError({
      userMessage: `App ${slug} is missing baseUrl or webhookSecret.`,
      suggestion: 'Confirm the app integration configuration in the database.',
    })
  }

  return {
    ...app,
    baseUrl: app.baseUrl,
    webhookSecret: app.webhookSecret,
  }
}

/**
 * List all registered apps
 */
export async function listApps(
  ctx: CommandContext,
  options: { json?: boolean }
): Promise<void> {
  const outputJson = options.json === true || ctx.format === 'json'

  try {
    const db = getDb()
    const apps = await db
      .select({
        slug: AppsTable.slug,
        name: AppsTable.name,
        baseUrl: AppsTable.integration_base_url,
      })
      .from(AppsTable)

    if (outputJson) {
      ctx.output.data(apps)
      return
    }

    ctx.output.data('\nRegistered Apps:')
    ctx.output.data('================')
    for (const app of apps) {
      ctx.output.data(`  ${app.slug} - ${app.name}`)
      ctx.output.data(`    URL: ${app.baseUrl}`)
      ctx.output.data('')
    }
  } catch (error) {
    handleToolsError(ctx, error, 'Failed to list registered apps.')
  }
}

/**
 * Test content search against an app
 */
export async function searchContent(
  ctx: CommandContext,
  slug: string,
  query: string,
  options: { types?: string; limit?: string; json?: boolean }
): Promise<void> {
  const outputJson = options.json === true || ctx.format === 'json'

  try {
    const app = await resolveAppConfig(slug)
    const limit = options.limit ? parseInt(options.limit, 10) : 5
    const types = options.types
      ? options.types
          .split(',')
          .map((value) => value.trim())
          .filter((value) => value.length > 0)
      : undefined

    if (Number.isNaN(limit) || limit < 1) {
      throw new CLIError({
        userMessage: '--limit must be a positive number.',
        suggestion: 'Provide a limit of 1 or greater (default: 5).',
      })
    }

    if (
      types &&
      types.some((type) => !CONTENT_TYPES.includes(type as ContentType))
    ) {
      throw new CLIError({
        userMessage: '--types contains an invalid content type.',
        suggestion:
          'Use a comma-separated list of: resource, course, module, lesson, article, exercise, social.',
      })
    }

    const client = new IntegrationClient({
      baseUrl: app.baseUrl,
      webhookSecret: app.webhookSecret,
    })

    if (!outputJson) {
      ctx.output.data(`\nSearching ${app.name} for: "${query}"`)
      ctx.output.data(`Endpoint: ${app.baseUrl}`)
      ctx.output.data('')
    }

    const result = await client.searchContent({
      query,
      types: types as ContentType[] | undefined,
      limit,
    })

    if (outputJson) {
      ctx.output.data(result)
      return
    }

    if (!result.results || result.results.length === 0) {
      ctx.output.data('No results found.')
      return
    }

    ctx.output.data(`Found ${result.results.length} results:\n`)
    for (const item of result.results) {
      ctx.output.data(`  [${item.type}] ${item.title}`)
      if (item.url) {
        ctx.output.data(`    URL: ${item.url}`)
      }
      if (item.description) {
        ctx.output.data(
          `    ${item.description.slice(0, 200)}${item.description.length > 200 ? '...' : ''}`
        )
      }
      ctx.output.data('')
    }
  } catch (error) {
    handleToolsError(ctx, error, 'Search failed.')
  }
}

/**
 * Test user lookup against an app
 */
export async function lookupUser(
  ctx: CommandContext,
  slug: string,
  email: string,
  options: { json?: boolean }
): Promise<void> {
  const outputJson = options.json === true || ctx.format === 'json'

  try {
    const app = await resolveAppConfig(slug)

    const client = new IntegrationClient({
      baseUrl: app.baseUrl,
      webhookSecret: app.webhookSecret,
    })

    if (!outputJson) {
      ctx.output.data(`\nLooking up user: ${email}`)
      ctx.output.data(`Endpoint: ${app.baseUrl}`)
      ctx.output.data('')
    }

    const user = await client.lookupUser(email)

    if (outputJson) {
      ctx.output.data(user)
      return
    }

    if (!user) {
      ctx.output.data('User not found.')
      return
    }

    ctx.output.data('User found:')
    ctx.output.data(`  ID: ${user.id}`)
    ctx.output.data(`  Email: ${user.email}`)
    if (user.name) ctx.output.data(`  Name: ${user.name}`)
    ctx.output.data('')
  } catch (error) {
    handleToolsError(ctx, error, 'Lookup failed.')
  }
}

/**
 * Test purchases lookup against an app
 */
export async function getPurchases(
  ctx: CommandContext,
  slug: string,
  userId: string,
  options: { json?: boolean }
): Promise<void> {
  const outputJson = options.json === true || ctx.format === 'json'

  try {
    const app = await resolveAppConfig(slug)

    const client = new IntegrationClient({
      baseUrl: app.baseUrl,
      webhookSecret: app.webhookSecret,
    })

    if (!outputJson) {
      ctx.output.data(`\nFetching purchases for user: ${userId}`)
      ctx.output.data(`Endpoint: ${app.baseUrl}`)
      ctx.output.data('')
    }

    const purchases = await client.getPurchases(userId)

    if (outputJson) {
      ctx.output.data(purchases)
      return
    }

    if (!purchases || purchases.length === 0) {
      ctx.output.data('No purchases found.')
      return
    }

    ctx.output.data(`Found ${purchases.length} purchases:\n`)
    for (const p of purchases) {
      ctx.output.data(`  [${p.id}] ${p.productName}`)
      ctx.output.data(`    Status: ${p.status}`)
      ctx.output.data(`    Amount: ${p.amount} ${p.currency}`)
      ctx.output.data(
        `    Date: ${new Date(p.purchasedAt).toLocaleDateString()}`
      )
      ctx.output.data('')
    }
  } catch (error) {
    handleToolsError(ctx, error, 'Fetch failed.')
  }
}

/**
 * Register tools commands
 */
export function registerToolsCommands(program: Command) {
  const tools = program
    .command('tools')
    .description('Test agent tools against live app integrations')

  tools
    .command('list')
    .description('List all registered apps')
    .option('--json', 'Output as JSON')
    .action(async (options, command) => {
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
      await listApps(ctx, options)
    })

  tools
    .command('search')
    .description('Test content search against an app')
    .argument('<app-slug>', 'App slug (e.g., total-typescript)')
    .argument('<query>', 'Search query')
    .option('-t, --types <types>', 'Filter by content types (comma-separated)')
    .option('-l, --limit <limit>', 'Max results (default: 5)')
    .option('--json', 'Output as JSON')
    .action(async (slug, query, options, command) => {
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
      await searchContent(ctx, slug, query, options)
    })

  tools
    .command('lookup')
    .description('Test user lookup against an app')
    .argument('<app-slug>', 'App slug')
    .argument('<email>', 'User email to look up')
    .option('--json', 'Output as JSON')
    .action(async (slug, email, options, command) => {
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
      await lookupUser(ctx, slug, email, options)
    })

  tools
    .command('purchases')
    .description('Test purchases lookup against an app')
    .argument('<app-slug>', 'App slug')
    .argument('<user-id>', 'User ID')
    .option('--json', 'Output as JSON')
    .action(async (slug, userId, options, command) => {
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
      await getPurchases(ctx, slug, userId, options)
    })
}
