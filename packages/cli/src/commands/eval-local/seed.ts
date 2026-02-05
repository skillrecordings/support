/**
 * Seed command for local eval environment
 * Populates MySQL and Qdrant with test fixtures
 */

import { join } from 'path'
import { glob } from 'glob'
import { type CommandContext } from '../../core/context'
import {
  cleanDatabase,
  cleanQdrant,
  loadJsonFiles,
  loadKnowledgeFiles,
  seedApps,
  seedKnowledgeBase,
} from '../../lib/eval-seed'

interface SeedOptions {
  clean?: boolean
  fixtures?: string
  json?: boolean
}

interface SeedResult {
  apps: number
  customers: number
  knowledge: number
  scenarios: number
  embeddings: number
}

export async function seed(
  ctx: CommandContext,
  options: SeedOptions
): Promise<void> {
  const fixturesPath = options.fixtures || 'fixtures'
  const outputJson = options.json === true || ctx.format === 'json'
  const log = (text: string): void => {
    if (!outputJson) ctx.output.data(text)
  }

  log('\n🌱 Seeding local eval environment...\n')

  const result: SeedResult = {
    apps: 0,
    customers: 0,
    knowledge: 0,
    scenarios: 0,
    embeddings: 0,
  }

  try {
    // Get MySQL connection
    const mysql = await import('mysql2/promise')
    const connection = await mysql.createConnection({
      host: 'localhost',
      port: 3306,
      user: 'eval_user',
      password: 'eval_pass',
      database: 'support_eval',
    })

    if (options.clean) {
      log('🧹 Cleaning existing data...')
      await cleanDatabase(connection)
      await cleanQdrant()
    }

    // 1. Seed apps
    log('📦 Seeding apps...')
    const apps = await loadJsonFiles(join(fixturesPath, 'apps'))
    result.apps = await seedApps(connection, apps)

    // 2. Seed customers (stored as JSON for mock lookups)
    log('👥 Loading customer fixtures...')
    const customers = await loadJsonFiles(join(fixturesPath, 'customers'))
    result.customers = customers.length
    // Customers are used by mock integration client, not stored in DB

    // 3. Seed knowledge base with embeddings
    log('📚 Seeding knowledge base...')
    const knowledge = await loadKnowledgeFiles(join(fixturesPath, 'knowledge'))
    result.knowledge = knowledge.length
    result.embeddings = await seedKnowledgeBase(knowledge, !outputJson)

    // 4. Count scenarios
    const scenarioFiles = await glob(join(fixturesPath, 'scenarios/**/*.json'))
    result.scenarios = scenarioFiles.length

    await connection.end()

    if (outputJson) {
      ctx.output.data({ success: true, result })
      return
    }

    ctx.output.data('\n✅ Seeding complete!\n')
    ctx.output.data(`   Apps:       ${result.apps}`)
    ctx.output.data(`   Customers:  ${result.customers}`)
    ctx.output.data(`   Knowledge:  ${result.knowledge} documents`)
    ctx.output.data(`   Embeddings: ${result.embeddings}`)
    ctx.output.data(`   Scenarios:  ${result.scenarios}\n`)
  } catch (error) {
    if (outputJson) {
      ctx.output.data({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    } else {
      ctx.output.error(
        `Seeding failed: ${error instanceof Error ? error.message : String(error)}`
      )
    }
    process.exitCode = 1
  }
}
