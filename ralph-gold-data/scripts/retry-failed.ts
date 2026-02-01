import { createAnthropic } from '@ai-sdk/anthropic'
import { generateText } from 'ai'
import Database from 'duckdb'
import crypto from 'crypto'

const FAILED_IDS = [
  'cnv_1jbwojj9', 'cnv_1jcox485', 'cnv_1jd7fzhh', 'cnv_1jdezmlh',
  'cnv_1jdg7fj9', 'cnv_1jdl2wh1', 'cnv_1jdn7nhh'
]

const anthropic = createAnthropic({
  baseURL: 'https://ai-gateway.vercel.sh/v1',
  apiKey: process.env.AI_GATEWAY_API_KEY!,
})

function robustJsonParse(text: string) {
  // Strip markdown code blocks
  let clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
  
  // Find JSON object
  const start = clean.indexOf('{')
  const end = clean.lastIndexOf('}')
  if (start === -1 || end === -1) throw new Error('No JSON found')
  
  let json = clean.slice(start, end + 1)
  
  // Fix common issues: unescaped newlines in strings
  json = json.replace(/:\s*"([^"]*)\n([^"]*)"/g, (_, a, b) => `: "${a}\\n${b}"`)
  
  return JSON.parse(json)
}

async function main() {
  const db = new Database.Database('gold.duckdb')
  const conn = db.connect()
  
  const rows: any[] = await new Promise((res, rej) => {
    conn.all(`
      SELECT id, request_type, subject, trigger_message, conversation_history
      FROM conversations WHERE id IN (${FAILED_IDS.map(id => `'${id}'`).join(',')})
    `, (err, rows) => err ? rej(err) : res(rows))
  })
  
  console.log(`Retrying ${rows.length} failed conversations...`)
  
  for (const row of rows) {
    const trigger = typeof row.trigger_message === 'string' 
      ? JSON.parse(row.trigger_message) : row.trigger_message || {}
    const history = typeof row.conversation_history === 'string'
      ? JSON.parse(row.conversation_history) : row.conversation_history || []
    
    const transcript = history
      .filter((m: any) => m?.body)
      .map((m: any) => `${m.direction === 'in' ? 'customer' : 'support'}: ${m.body.slice(0, 800)}`)
      .join('\n')
    
    const prompt = `Extract a reusable support template from this conversation.

Category: ${row.request_type}
Subject: ${row.subject || 'N/A'}

Transcript:
${transcript.slice(0, 2000)}

Return valid JSON only (no markdown):
{"pattern": "what customer wants", "template": "reusable response with {{variables}}", "variables": [], "confidence": 0.8}`

    try {
      const { text } = await generateText({
        model: anthropic('claude-3-haiku-[PHONE]'),
        maxTokens: 500,
        prompt,
      })
      
      const parsed = robustJsonParse(text)
      
      await new Promise<void>((res, rej) => {
        conn.run(
          `INSERT INTO templates (id, conversation_id, pattern, template, variables, category, confidence)
           VALUES (?, ?, ?, ?, CAST(? AS JSON), ?, ?)`,
          crypto.randomUUID(), row.id, parsed.pattern, parsed.template,
          JSON.stringify(parsed.variables || []), row.request_type, parsed.confidence || 0.8,
          (err: any) => err ? rej(err) : res()
        )
      })
      
      console.log(`✅ ${row.id}: ${parsed.pattern.slice(0, 50)}...`)
    } catch (e: any) {
      console.log(`❌ ${row.id}: ${e.message}`)
    }
  }
  
  const count: any[] = await new Promise((res, rej) => {
    conn.all('SELECT COUNT(*) as cnt FROM templates', (err, rows) => err ? rej(err) : res(rows))
  })
  console.log(`\nTotal templates: ${count[0]?.cnt}`)
  
  conn.close()
  db.close()
}

main()
