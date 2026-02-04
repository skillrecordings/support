/**
 * Seed command for local eval environment
 * Populates MySQL and Qdrant with test fixtures
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
  customers: number
  knowledge: number
  scenarios: number
  embeddings: number
}

export async function seed(options: SeedOptions): Promise<void> {
  const fixturesPath = options.fixtures || 'fixtures'

  if (!options.json) {
    console.log('\n🌱 Seeding local eval environment...\n')
  }

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
      if (!options.json) console.log('🧹 Cleaning existing data...')
      await cleanDatabase(connection)

      const qdrantUrl = process.env.QDRANT_URL || 'http://localhost:6333'
      const collection = process.env.QDRANT_COLLECTION || 'knowledge'
      try {
        await fetch(`${qdrantUrl}/collections/${collection}`, {
          method: 'DELETE',
        })
      } catch {
        // Collection might not exist yet, ignore
      }
    }

    // 1. Seed apps
    if (!options.json) console.log('📦 Seeding apps...')
    const apps = await loadJsonFiles(join(fixturesPath, 'apps'))
    result.apps = await seedApps(connection, apps)

    // 2. Seed customers (stored as JSON for mock lookups)
    if (!options.json) console.log('👥 Loading customer fixtures...')
    const customers = await loadJsonFiles(join(fixturesPath, 'customers'))
    result.customers = customers.length
    // Customers are used by mock integration client, not stored in DB

    // 3. Seed knowledge base with embeddings
    if (!options.json) console.log('📚 Seeding knowledge base...')
    const knowledge = await loadKnowledgeFiles(join(fixturesPath, 'knowledge'))
    result.knowledge = knowledge.length
    result.embeddings = await seedKnowledgeBase(knowledge, !options.json)

    // 4. Count scenarios
    const scenarioFiles = await glob(join(fixturesPath, 'scenarios/**/*.json'))
    result.scenarios = scenarioFiles.length

    await connection.end()

    if (options.json) {
      console.log(JSON.stringify({ success: true, result }, null, 2))
    } else {
      console.log('\n✅ Seeding complete!\n')
      console.log(`   Apps:       ${result.apps}`)
      console.log(`   Customers:  ${result.customers}`)
      console.log(`   Knowledge:  ${result.knowledge} documents`)
      console.log(`   Embeddings: ${result.embeddings}`)
      console.log(`   Scenarios:  ${result.scenarios}\n`)
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
