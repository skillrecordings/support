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

/**
 * Get app config from database by slug
 */
async function getAppConfig(slug: string) {
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

/**
 * List all registered apps
 */
async function listApps(options: { json?: boolean }) {
  const db = getDb()
  const apps = await db
    .select({
      slug: AppsTable.slug,
      name: AppsTable.name,
      baseUrl: AppsTable.integration_base_url,
    })
    .from(AppsTable)

  if (options.json) {
    console.log(JSON.stringify(apps, null, 2))
    return
  }

  console.log('\nRegistered Apps:')
  console.log('================')
  for (const app of apps) {
    console.log(`  ${app.slug} - ${app.name}`)
    console.log(`    URL: ${app.baseUrl}`)
    console.log()
  }
}

/**
 * Test content search against an app
 */
async function searchContent(
  slug: string,
  query: string,
  options: { types?: string; limit?: string; json?: boolean }
) {
  const app = await getAppConfig(slug)
  if (!app) {
    console.error(`App not found: ${slug}`)
    console.error('Use "skill tools list" to see registered apps')
    process.exit(1)
  }

  if (!app.baseUrl || !app.webhookSecret) {
    console.error(`App ${slug} is missing baseUrl or webhookSecret`)
    process.exit(1)
  }

  const client = new IntegrationClient({
    baseUrl: app.baseUrl,
    webhookSecret: app.webhookSecret,
  })

  console.log(`\nSearching ${app.name} for: "${query}"`)
  console.log(`Endpoint: ${app.baseUrl}`)
  console.log()

  try {
    const result = await client.searchContent({
      query,
      types: options.types?.split(',') as any,
      limit: options.limit ? parseInt(options.limit, 10) : 5,
    })

    if (options.json) {
      console.log(JSON.stringify(result, null, 2))
      return
    }

    if (!result.results || result.results.length === 0) {
      console.log('No results found.')
      return
    }

    console.log(`Found ${result.results.length} results:\n`)
    for (const item of result.results) {
      console.log(`  [${item.type}] ${item.title}`)
      if (item.url) {
        console.log(`    URL: ${item.url}`)
      }
      if (item.description) {
        console.log(
          `    ${item.description.slice(0, 200)}${item.description.length > 200 ? '...' : ''}`
        )
      }
      console.log()
    }
  } catch (error) {
    console.error(
      'Search failed:',
      error instanceof Error ? error.message : error
    )
    process.exit(1)
  }
}

/**
 * Test user lookup against an app
 */
async function lookupUser(
  slug: string,
  email: string,
  options: { json?: boolean }
) {
  const app = await getAppConfig(slug)
  if (!app) {
    console.error(`App not found: ${slug}`)
    process.exit(1)
  }

  if (!app.baseUrl || !app.webhookSecret) {
    console.error(`App ${slug} is missing baseUrl or webhookSecret`)
    process.exit(1)
  }

  const client = new IntegrationClient({
    baseUrl: app.baseUrl,
    webhookSecret: app.webhookSecret,
  })

  console.log(`\nLooking up user: ${email}`)
  console.log(`Endpoint: ${app.baseUrl}`)
  console.log()

  try {
    const user = await client.lookupUser(email)

    if (options.json) {
      console.log(JSON.stringify(user, null, 2))
      return
    }

    if (!user) {
      console.log('User not found.')
      return
    }

    console.log('User found:')
    console.log(`  ID: ${user.id}`)
    console.log(`  Email: ${user.email}`)
    if (user.name) console.log(`  Name: ${user.name}`)
    console.log()
  } catch (error) {
    console.error(
      'Lookup failed:',
      error instanceof Error ? error.message : error
    )
    process.exit(1)
  }
}

/**
 * Test purchases lookup against an app
 */
async function getPurchases(
  slug: string,
  userId: string,
  options: { json?: boolean }
) {
  const app = await getAppConfig(slug)
  if (!app) {
    console.error(`App not found: ${slug}`)
    process.exit(1)
  }

  if (!app.baseUrl || !app.webhookSecret) {
    console.error(`App ${slug} is missing baseUrl or webhookSecret`)
    process.exit(1)
  }

  const client = new IntegrationClient({
    baseUrl: app.baseUrl,
    webhookSecret: app.webhookSecret,
  })

  console.log(`\nFetching purchases for user: ${userId}`)
  console.log(`Endpoint: ${app.baseUrl}`)
  console.log()

  try {
    const purchases = await client.getPurchases(userId)

    if (options.json) {
      console.log(JSON.stringify(purchases, null, 2))
      return
    }

    if (!purchases || purchases.length === 0) {
      console.log('No purchases found.')
      return
    }

    console.log(`Found ${purchases.length} purchases:\n`)
    for (const p of purchases) {
      console.log(`  [${p.id}] ${p.productName}`)
      console.log(`    Status: ${p.status}`)
      console.log(`    Amount: ${p.amount} ${p.currency}`)
      console.log(`    Date: ${new Date(p.purchasedAt).toLocaleDateString()}`)
      console.log()
    }
  } catch (error) {
    console.error(
      'Fetch failed:',
      error instanceof Error ? error.message : error
    )
    process.exit(1)
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
    .action(listApps)

  tools
    .command('search')
    .description('Test content search against an app')
    .argument('<app-slug>', 'App slug (e.g., total-typescript)')
    .argument('<query>', 'Search query')
    .option('-t, --types <types>', 'Filter by content types (comma-separated)')
    .option('-l, --limit <limit>', 'Max results (default: 5)')
    .option('--json', 'Output as JSON')
    .action(searchContent)

  tools
    .command('lookup')
    .description('Test user lookup against an app')
    .argument('<app-slug>', 'App slug')
    .argument('<email>', 'User email to look up')
    .option('--json', 'Output as JSON')
    .action(lookupUser)

  tools
    .command('purchases')
    .description('Test purchases lookup against an app')
    .argument('<app-slug>', 'App slug')
    .argument('<user-id>', 'User ID')
    .option('--json', 'Output as JSON')
    .action(getPurchases)
}
