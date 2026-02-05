import { join } from 'path'
import { readFile, readdir } from 'fs/promises'
import { glob } from 'glob'
import matter from 'gray-matter'

export interface KnowledgeDoc {
  id: string
  content: string
  type: string
  app: string
  tags: string[]
  title: string
  filePath: string
}

interface QdrantPoint {
  id: string
  vector: number[]
  payload: Record<string, unknown>
}

export function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

export async function cleanDatabase(connection: any): Promise<void> {
  await connection.execute('SET FOREIGN_KEY_CHECKS = 0')

  const tables = [
    'SUPPORT_dead_letter_queue',
    'SUPPORT_trust_scores',
    'SUPPORT_audit_log',
    'SUPPORT_approval_requests',
    'SUPPORT_actions',
    'SUPPORT_conversations',
    'SUPPORT_apps',
  ]

  for (const table of tables) {
    try {
      await connection.execute(`TRUNCATE TABLE ${table}`)
    } catch {
      // Table might not exist yet, ignore
    }
  }

  await connection.execute('SET FOREIGN_KEY_CHECKS = 1')
}

export async function cleanQdrant(): Promise<void> {
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

export async function loadJsonFiles(dirPath: string): Promise<any[]> {
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
  } catch {
    return []
  }
}

export async function loadKnowledgeFiles(
  basePath: string
): Promise<KnowledgeDoc[]> {
  const files = await glob(join(basePath, '**/*.md'))
  const docs: KnowledgeDoc[] = []

  for (const filePath of files) {
    const content = await readFile(filePath, 'utf-8')
    const { data: frontmatter, content: body } = matter(content)

    const titleMatch = body.match(/^#\s+(.+)$/m)
    const title =
      titleMatch?.[1] ??
      filePath.split('/').pop()?.replace('.md', '') ??
      'Untitled'

    docs.push({
      id: generateUUID(),
      content: body.trim(),
      type: frontmatter.type || 'general',
      app: frontmatter.app || 'unknown',
      tags: frontmatter.tags || [],
      title,
      filePath,
    })
  }

  return docs
}

export async function seedApps(connection: any, apps: any[]): Promise<number> {
  for (const app of apps) {
    await connection.execute(
      `INSERT INTO SUPPORT_apps (
        id, slug, name, front_inbox_id, instructor_teammate_id,
        stripe_account_id, stripe_connected, integration_base_url,
        webhook_secret, capabilities, auto_approve_refund_days, auto_approve_transfer_days
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        name = VALUES(name),
        integration_base_url = VALUES(integration_base_url),
        capabilities = VALUES(capabilities)`,
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
        app.auto_approve_refund_days || 30,
        app.auto_approve_transfer_days || 14,
      ]
    )

    const categories = ['refund', 'access', 'technical', 'general', 'transfer']
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

export async function seedKnowledgeBase(
  docs: KnowledgeDoc[],
  showProgress: boolean
): Promise<number> {
  if (docs.length === 0) return 0

  const qdrantUrl = process.env.QDRANT_URL || 'http://localhost:6333'
  const collection = process.env.QDRANT_COLLECTION || 'knowledge'
  const ollamaUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434'
  const embeddingModel = process.env.EMBEDDING_MODEL || 'mxbai-embed-large'

  const vectorSize = embeddingModel.includes('mxbai') ? 1024 : 768

  const existsRes = await fetch(`${qdrantUrl}/collections/${collection}`)

  if (existsRes.status === 404) {
    const createRes = await fetch(`${qdrantUrl}/collections/${collection}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vectors: {
          size: vectorSize,
          distance: 'Cosine',
        },
      }),
    })

    if (!createRes.ok) {
      const error = await createRes.text()
      throw new Error(`Failed to create Qdrant collection: ${error}`)
    }
  }

  try {
    const healthRes = await fetch(`${ollamaUrl}/api/tags`)
    if (!healthRes.ok) {
      throw new Error('Ollama is not responding')
    }
  } catch {
    throw new Error(
      `Ollama not available at ${ollamaUrl}. ` +
        'Make sure Ollama is running: ollama serve'
    )
  }

  let embeddedCount = 0
  const batchSize = 5
  const points: QdrantPoint[] = []

  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i]
    if (!doc) continue

    try {
      const embedRes = await fetch(`${ollamaUrl}/api/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: embeddingModel,
          input: doc.content,
        }),
      })

      if (!embedRes.ok) {
        const error = await embedRes.text()
        throw new Error(`Embedding failed: ${error}`)
      }

      const embedData = (await embedRes.json()) as {
        embeddings?: number[][]
        embedding?: number[]
      }
      const vector = embedData.embeddings?.[0] ?? embedData.embedding

      if (!vector) {
        throw new Error('No embedding returned from Ollama')
      }

      points.push({
        id: doc.id,
        vector,
        payload: {
          content: doc.content,
          title: doc.title,
          type: doc.type,
          app: doc.app,
          tags: doc.tags,
        },
      })

      embeddedCount++

      if (showProgress) {
        process.stdout.write(`\r   Embedded: ${embeddedCount}/${docs.length}`)
      }

      if (points.length >= batchSize || i === docs.length - 1) {
        const upsertRes = await fetch(
          `${qdrantUrl}/collections/${collection}/points`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ points }),
          }
        )

        if (!upsertRes.ok) {
          const error = await upsertRes.text()
          throw new Error(`Failed to upsert points: ${error}`)
        }

        points.length = 0
      }
    } catch (error) {
      if (showProgress) {
        console.error(`\n   Failed to embed ${doc.title}:`, error)
      }
    }
  }

  if (showProgress) {
    console.log('')
  }

  return embeddedCount
}
