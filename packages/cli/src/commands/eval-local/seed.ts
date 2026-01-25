/**
 * Seed command for local eval environment
 * Populates MySQL and Qdrant with test fixtures
 */

import { join } from 'path'
import { createOllamaClient } from '@skillrecordings/core/adapters/ollama'
import { createQdrantClient } from '@skillrecordings/core/adapters/qdrant'
import { readFile, readdir } from 'fs/promises'
import { glob } from 'glob'
import matter from 'gray-matter'

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

      // Also clean Qdrant
      const qdrant = createQdrantClient()
      await qdrant.deleteCollection()
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
    result.embeddings = await seedKnowledgeBase(knowledge)

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

async function cleanDatabase(connection: any): Promise<void> {
  // Disable foreign key checks temporarily
  await connection.execute('SET FOREIGN_KEY_CHECKS = 0')

  const tables = [
    'SUPPORT_trust_scores',
    'SUPPORT_audit_log',
    'SUPPORT_approval_requests',
    'SUPPORT_actions',
    'SUPPORT_conversations',
    'SUPPORT_apps',
  ]

  for (const table of tables) {
    await connection.execute(`TRUNCATE TABLE ${table}`)
  }

  await connection.execute('SET FOREIGN_KEY_CHECKS = 1')
}

async function loadJsonFiles(dirPath: string): Promise<any[]> {
  try {
    const files = await readdir(dirPath)
    const jsonFiles = files.filter((f) => f.endsWith('.json'))

    const items = await Promise.all(
      jsonFiles.map(async (file) => {
        const content = await readFile(join(dirPath, file), 'utf-8')
        return JSON.parse(content)
      })
    )

    return items
  } catch (error) {
    return []
  }
}

interface KnowledgeDoc {
  id: string
  content: string
  type: string
  app: string
  tags: string[]
  filePath: string
}

function generateUUID(): string {
  // Simple UUID v4 generation
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

async function loadKnowledgeFiles(basePath: string): Promise<KnowledgeDoc[]> {
  const files = await glob(join(basePath, '**/*.md'))
  const docs: KnowledgeDoc[] = []

  for (const filePath of files) {
    const content = await readFile(filePath, 'utf-8')
    const { data: frontmatter, content: body } = matter(content)

    // Generate UUID for Qdrant compatibility
    const id = generateUUID()

    docs.push({
      id,
      content: body.trim(),
      type: frontmatter.type || 'general',
      app: frontmatter.app || 'unknown',
      tags: frontmatter.tags || [],
      filePath,
    })
  }

  return docs
}

async function seedApps(connection: any, apps: any[]): Promise<number> {
  for (const app of apps) {
    await connection.execute(
      `INSERT INTO SUPPORT_apps (
        id, slug, name, front_inbox_id, instructor_teammate_id,
        stripe_account_id, stripe_connected, integration_base_url,
        webhook_secret, capabilities
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        name = VALUES(name),
        integration_base_url = VALUES(integration_base_url)`,
      [
        app.id,
        app.slug,
        app.name,
        app.front_inbox_id,
        app.instructor_teammate_id || null,
        app.stripe_account_id || null,
        app.stripe_connected || false,
        app.integration_base_url,
        app.webhook_secret,
        JSON.stringify(app.capabilities || []),
      ]
    )

    // Seed default trust scores for this app
    const categories = ['refund', 'access', 'technical', 'general']
    for (const category of categories) {
      const id = `ts_${app.id}_${category}`
      await connection.execute(
        `INSERT INTO SUPPORT_trust_scores (id, app_id, category, trust_score, sample_count)
         VALUES (?, ?, ?, 0.75, 25)
         ON DUPLICATE KEY UPDATE id = id`,
        [id, app.id, category]
      )
    }
  }

  return apps.length
}

async function seedKnowledgeBase(docs: KnowledgeDoc[]): Promise<number> {
  if (docs.length === 0) return 0

  const qdrant = createQdrantClient()
  const ollama = createOllamaClient()

  // Ensure model is available
  await ollama.ensureModel()

  // Ensure collection exists
  // Use 1024 for mxbai-embed-large, 768 for nomic-embed-text
  const embeddingModel = process.env.EMBEDDING_MODEL || 'mxbai-embed-large'
  const vectorSize = embeddingModel.includes('mxbai') ? 1024 : 768
  await qdrant.ensureCollection(vectorSize)

  let embeddedCount = 0

  for (const doc of docs) {
    try {
      // Generate embedding
      const embedding = await ollama.embed(doc.content)

      // Store in Qdrant
      await qdrant.upsert([
        {
          id: doc.id,
          vector: embedding,
          payload: {
            content: doc.content,
            type: doc.type,
            app: doc.app,
            tags: doc.tags,
          },
        },
      ])

      embeddedCount++
      process.stdout.write(`\r   Embedded: ${embeddedCount}/${docs.length}`)
    } catch (error) {
      console.error(`\n   Failed to embed ${doc.id}:`, error)
    }
  }

  console.log('') // New line after progress
  return embeddedCount
}
