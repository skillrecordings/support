/**
 * Upload templates from DuckDB to Redis
 */
import path from 'path'
import Database from 'duckdb'
import {
  storeTemplates,
  getCategoryStats,
  closeRedisClient,
  type Template,
  type TemplateVariable
} from './redis-schema'

const DB_PATH = path.resolve('gold.duckdb')

interface TemplateRow {
  id: string
  conversation_id: string | null
  pattern: string
  template: string
  variables: string | object
  category: string
  confidence: number
  source: string | null
}

function parseVariables(raw: string | object): TemplateVariable[] {
  try {
    const arr = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!Array.isArray(arr)) return []
    return arr.map(v => ({
      name: v.name || 'unknown',
      source: v.source || 'customer_message'
    }))
  } catch {
    return []
  }
}

async function main(): Promise<void> {
  console.log('=== Upload Templates to Redis ===\n')
  
  // Read from DuckDB
  const db = new Database.Database(DB_PATH)
  const connection = db.connect()
  
  const rows = await new Promise<TemplateRow[]>((resolve, reject) => {
    connection.all(
      `SELECT id, conversation_id, pattern, template, variables, category, confidence, source FROM templates`,
      (err, rows) => {
        if (err) reject(err)
        else resolve(rows as TemplateRow[])
      }
    )
  })
  
  console.log(`Read ${rows.length} templates from DuckDB`)
  
  // Transform to Template objects
  const templates: Template[] = rows.map(row => ({
    id: row.id,
    conversationId: row.conversation_id || undefined,
    pattern: row.pattern,
    template: row.template,
    variables: parseVariables(row.variables),
    category: row.category,
    confidence: row.confidence,
    source: row.source || undefined,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }))
  
  // Upload to Redis
  const stored = await storeTemplates(templates)
  console.log(`Uploaded ${stored} templates to Redis`)
  
  // Show stats
  const stats = await getCategoryStats()
  console.log('\nTemplates by category in Redis:')
  for (const [category, count] of stats) {
    console.log(`  ${category}: ${count}`)
  }
  
  // Cleanup
  connection.close()
  db.close()
  await closeRedisClient()
  
  console.log('\n✅ Upload complete!')
}

main().catch(err => {
  console.error(err)
  process.exitCode = 1
})
