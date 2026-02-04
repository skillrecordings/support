/**
 * Seed command for eval-pipeline
 * Populates MySQL and Qdrant with test fixtures for honest pipeline evals
 */

import { join } from 'path'
import { glob } from 'glob'
import { type CommandContext } from '../../core/context'
import { CLIError, formatError } from '../../core/errors'
import {
  cleanDatabase,
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
  trustScores: number
  customers: number
  knowledge: number
  embeddings: number
  scenarios: number
}

export async function seed(
  ctx: CommandContext,
  options: SeedOptions
): Promise<void> {
  const fixturesPath = options.fixtures || 'fixtures'
  const outputJson = options.json === true || ctx.format === 'json'

  if (!outputJson) {
    ctx.output.data('\n🌱 Seeding eval-pipeline environment...\n')
  }

  const result: SeedResult = {
    apps: 0,
    trustScores: 0,
    customers: 0,
    knowledge: 0,
    embeddings: 0,
    scenarios: 0,
  }

  try {
    // Get MySQL connection
    const mysql = await import('mysql2/promise')
    const connection = await mysql.createConnection({
      host: process.env.MYSQL_HOST || 'localhost',
      port: parseInt(process.env.MYSQL_PORT || '3306'),
      user: process.env.MYSQL_USER || 'eval_user',
      password: process.env.MYSQL_PASSWORD || 'eval_pass',
      database: process.env.MYSQL_DATABASE || 'support_eval',
    })

    if (options.clean) {
      if (!outputJson) ctx.output.message('🧹 Cleaning existing data...')
      await cleanDatabase(connection)
      await cleanQdrant()
    }

    // 1. Seed apps
    if (!outputJson) ctx.output.message('📦 Seeding apps...')
    const apps = await loadJsonFiles(join(fixturesPath, 'apps'))
    result.apps = await seedApps(connection, apps)

    // 2. Count trust scores seeded with apps
    const [trustRows] = await connection.execute(
      'SELECT COUNT(*) as count FROM SUPPORT_trust_scores'
    )
    result.trustScores = (trustRows as any)[0].count

    // 3. Load customer fixtures (used by mock integration, not stored in DB)
    if (!outputJson) ctx.output.message('👥 Loading customer fixtures...')
    const customers = await loadJsonFiles(join(fixturesPath, 'customers'))
    result.customers = customers.length

    // 4. Seed knowledge base with embeddings
    if (!outputJson) ctx.output.message('📚 Seeding knowledge base...')
    const knowledge = await loadKnowledgeFiles(join(fixturesPath, 'knowledge'))
    result.knowledge = knowledge.length
    result.embeddings = await seedKnowledgeBase(knowledge, !outputJson)

    // 5. Count scenarios
    const scenarioFiles = await glob(join(fixturesPath, 'scenarios/**/*.json'))
    result.scenarios = scenarioFiles.length

    await connection.end()

    if (outputJson) {
      ctx.output.data({ success: true, result })
    } else {
      ctx.output.success('Seeding complete!')
      ctx.output.data(`   Apps:         ${result.apps}`)
      ctx.output.data(`   Trust Scores: ${result.trustScores}`)
      ctx.output.data(`   Customers:    ${result.customers} (fixture files)`)
      ctx.output.data(`   Knowledge:    ${result.knowledge} documents`)
      ctx.output.data(`   Embeddings:   ${result.embeddings}`)
      ctx.output.data(`   Scenarios:    ${result.scenarios}\n`)
    }
  } catch (error) {
    const cliError =
      error instanceof CLIError
        ? error
        : new CLIError({
            userMessage: 'Seeding failed.',
            suggestion: 'Verify database and Qdrant configuration.',
            cause: error,
          })

    if (outputJson) {
      ctx.output.data({
        success: false,
        error: cliError.message,
      })
    } else {
      ctx.output.error(formatError(cliError))
    }
    process.exitCode = cliError.exitCode
  }
}

async function cleanQdrant(): Promise<void> {
  const qdrantUrl = process.env.QDRANT_URL || 'http://localhost:6333'
  const collection = process.env.QDRANT_COLLECTION || 'knowledge'

  try {
    await fetch(`${qdrantUrl}/collections/${collection}`, {
      method: 'DELETE',
    })
  } catch {
    // Collection might not exist, ignore
  }
}
