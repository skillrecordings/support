/**
 * Parse templates-for-review.md and insert into DuckDB templates table
 */
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import Database from 'duckdb'

const MD_PATH = path.resolve('reports/templates-for-review.md')
const DB_PATH = path.resolve('gold.duckdb')

interface ParsedTemplate {
  category: string
  pattern: string
  template: string
  variables: Array<{ name: string; source: string }>
  confidence: number
  source: string
}

function parseMarkdown(content: string): ParsedTemplate[] {
  const templates: ParsedTemplate[] = []
  const lines = content.split('\n')
  
  let currentCategory = ''
  let i = 0
  
  while (i < lines.length) {
    const line = lines[i]
    
    // Category header: ### category_name
    if (line.startsWith('### ')) {
      currentCategory = line.slice(4).trim()
      i++
      continue
    }
    
    // Pattern start: **Pattern:** description
    if (line.startsWith('**Pattern:**')) {
      const pattern = line.slice(12).trim()
      i++
      
      // Skip blank lines
      while (i < lines.length && lines[i].trim() === '') i++
      
      // Collect template text (blockquote lines starting with >)
      const templateLines: string[] = []
      while (i < lines.length && lines[i].startsWith('>')) {
        // Remove leading '> ' or '>'
        const templateLine = lines[i].replace(/^>\s?/, '')
        templateLines.push(templateLine)
        i++
      }
      const template = templateLines.join('\n').trim()
      
      // Skip blank lines
      while (i < lines.length && lines[i].trim() === '') i++
      
      // Parse metadata lines
      let variables: Array<{ name: string; source: string }> = []
      let confidence = 0.8
      let source = ''
      
      while (i < lines.length && lines[i].startsWith('- ')) {
        const metaLine = lines[i].slice(2).trim()
        
        if (metaLine.startsWith('Variables:')) {
          const varStr = metaLine.slice(10).trim()
          if (varStr !== 'None' && varStr !== '`None`') {
            // Parse variables like `{{name}}`, `{{email}}`
            const varMatches = varStr.match(/\{\{(\w+)\}\}/g) || []
            variables = varMatches.map(v => ({
              name: v.replace(/\{\{|\}\}/g, ''),
              source: 'customer_message' // default
            }))
          }
        } else if (metaLine.startsWith('Confidence:')) {
          const confStr = metaLine.slice(11).trim().replace('%', '')
          confidence = parseInt(confStr, 10) / 100
        } else if (metaLine.startsWith('Source:')) {
          source = metaLine.slice(7).trim().replace(/^"|"$/g, '')
        }
        
        i++
      }
      
      if (pattern && template && currentCategory) {
        templates.push({
          category: currentCategory,
          pattern,
          template,
          variables,
          confidence,
          source
        })
      }
      
      continue
    }
    
    i++
  }
  
  return templates
}

async function main(): Promise<void> {
  console.log('=== Import Templates from Markdown ===')
  
  const content = fs.readFileSync(MD_PATH, 'utf-8')
  const templates = parseMarkdown(content)
  
  console.log(`Parsed ${templates.length} templates from markdown`)
  
  // Show category breakdown
  const byCategory = new Map<string, number>()
  for (const t of templates) {
    byCategory.set(t.category, (byCategory.get(t.category) || 0) + 1)
  }
  console.log('\nBy category:')
  for (const [cat, count] of byCategory) {
    console.log(`  ${cat}: ${count}`)
  }
  
  // Connect to DuckDB
  const db = new Database.Database(DB_PATH)
  const connection = db.connect()
  
  const runQuery = (sql: string): Promise<void> =>
    new Promise((resolve, reject) => {
      connection.run(sql, (err: Error | null) => {
        if (err) reject(err)
        else resolve()
      })
    })
  
  // Create templates table
  await runQuery(`
    CREATE TABLE IF NOT EXISTS templates (
      id VARCHAR PRIMARY KEY,
      conversation_id VARCHAR,
      pattern VARCHAR NOT NULL,
      template VARCHAR NOT NULL,
      variables JSON NOT NULL,
      category VARCHAR NOT NULL,
      confidence DOUBLE NOT NULL,
      source VARCHAR
    );
  `)
  
  // Clear existing templates
  await runQuery('DELETE FROM templates;')
  
  // Prepare insert statement
  const insertStatement = connection.prepare(
    'INSERT INTO templates (id, conversation_id, pattern, template, variables, category, confidence, source) VALUES (?, ?, ?, ?, CAST(? AS JSON), ?, ?, ?)'
  )
  
  const runInsert = (
    id: string,
    conversationId: string | null,
    pattern: string,
    template: string,
    variables: string,
    category: string,
    confidence: number,
    source: string
  ): Promise<void> =>
    new Promise((resolve, reject) => {
      insertStatement.run(id, conversationId, pattern, template, variables, category, confidence, source, (err: Error | null) => {
        if (err) reject(err)
        else resolve()
      })
    })
  
  // Insert templates
  let inserted = 0
  for (const t of templates) {
    await runInsert(
      crypto.randomUUID(),
      null, // No conversation_id from markdown
      t.pattern,
      t.template,
      JSON.stringify(t.variables),
      t.category,
      t.confidence,
      t.source
    )
    inserted++
  }
  
  console.log(`\nInserted ${inserted} templates into DuckDB`)
  
  // Verify
  const allQuery = <T>(sql: string): Promise<T[]> =>
    new Promise((resolve, reject) => {
      connection.all(sql, (err: Error | null, rows: T[]) => {
        if (err) reject(err)
        else resolve(rows)
      })
    })
  
  const countRows = await allQuery<{ count: number }>('SELECT COUNT(*)::INTEGER AS count FROM templates')
  console.log(`Verified: ${countRows[0]?.count} templates in database`)
  
  connection.close()
  db.close()
}

main().catch(err => {
  console.error(err)
  process.exitCode = 1
})
