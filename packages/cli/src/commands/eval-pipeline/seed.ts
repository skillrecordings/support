/**
 * Seed command for eval-pipeline
 * Populates MySQL and Qdrant with test fixtures for honest pipeline evals
 */

import { join } from 'path'
import { glob } from 'glob'
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

export async function seed(options: SeedOptions): Promise<void> {
  const fixturesPath = options.fixtures || 'fixtures'

  if (!options.json) {
    console.log('\n🌱 Seeding eval-pipeline environment...\n')
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
      if (!options.json) console.log('🧹 Cleaning existing data...')
      await cleanDatabase(connection)
      await cleanQdrant()
    }

    // 1. Seed apps
    if (!options.json) console.log('📦 Seeding apps...')
    const apps = await loadJsonFiles(join(fixturesPath, 'apps'))
    result.apps = await seedApps(connection, apps)

    // 2. Count trust scores seeded with apps
    const [trustRows] = await connection.execute(
      'SELECT COUNT(*) as count FROM SUPPORT_trust_scores'
    )
    result.trustScores = (trustRows as any)[0].count

    // 3. Load customer fixtures (used by mock integration, not stored in DB)
    if (!options.json) console.log('👥 Loading customer fixtures...')
    const customers = await loadJsonFiles(join(fixturesPath, 'customers'))
    result.customers = customers.length

    // 4. Seed knowledge base with embeddings
    if (!options.json) console.log('📚 Seeding knowledge base...')
    const knowledge = await loadKnowledgeFiles(join(fixturesPath, 'knowledge'))
    result.knowledge = knowledge.length
    result.embeddings = await seedKnowledgeBase(knowledge, !options.json)

    // 5. Count scenarios
    const scenarioFiles = await glob(join(fixturesPath, 'scenarios/**/*.json'))
    result.scenarios = scenarioFiles.length

    await connection.end()

    if (options.json) {
      console.log(JSON.stringify({ success: true, result }, null, 2))
    } else {
      console.log('\n✅ Seeding complete!\n')
      console.log(`   Apps:         ${result.apps}`)
      console.log(`   Trust Scores: ${result.trustScores}`)
      console.log(`   Customers:    ${result.customers} (fixture files)`)
      console.log(`   Knowledge:    ${result.knowledge} documents`)
      console.log(`   Embeddings:   ${result.embeddings}`)
      console.log(`   Scenarios:    ${result.scenarios}\n`)
    }
  } catch (error) {
    if (options.json) {
      console.log(
        JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        })
      )
    } else {
      console.error('❌ Seeding failed:', error)
    }
    process.exit(1)
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
