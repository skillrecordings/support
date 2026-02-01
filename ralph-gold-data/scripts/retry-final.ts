import { createAnthropic } from '@ai-sdk/anthropic'
import { generateText } from 'ai'
import Database from 'duckdb'
import crypto from 'crypto'

const FAILED_IDS = ['cnv_1jbwojj9', 'cnv_1jd7fzhh', 'cnv_1jdl2wh1', 'cnv_1jdn7nhh']

const anthropic = createAnthropic({
  baseURL: 'https://ai-gateway.vercel.sh/v1',
  apiKey: process.env.AI_GATEWAY_API_KEY!,
})

async function main() {
  const db = new Database.Database('gold.duckdb')
  const conn = db.connect()
  
  const rows: any[] = await new Promise((res, rej) => {
    conn.all(`
      SELECT id, request_type, subject, trigger_message
      FROM conversations WHERE id IN (${FAILED_IDS.map(id => `'${id}'`).join(',')})
    `, (err, rows) => err ? rej(err) : res(rows))
  })
  
  for (const row of rows) {
    const trigger = typeof row.trigger_message === 'string' 
      ? JSON.parse(row.trigger_message) : row.trigger_message || {}
    
    // Super simple prompt
    const prompt = `Category: ${row.request_type}
Subject: ${row.subject || 'N/A'}
Message: ${(trigger.body || '').slice(0, 500)}

Write a ONE LINE pattern and ONE LINE template. No special characters or newlines in your response.
Format exactly: PATTERN: [what customer wants] | TEMPLATE: [support response]`

    try {
      const { text } = await generateText({
        model: anthropic('claude-3-haiku-[PHONE]'),
        maxTokens: 200,
        prompt,
      })
      
      const match = text.match(/PATTERN:\s*(.+?)\s*\|\s*TEMPLATE:\s*(.+)/i)
      if (!match) throw new Error('Format mismatch')
      
      await new Promise<void>((res, rej) => {
        conn.run(
          `INSERT INTO templates (id, conversation_id, pattern, template, variables, category, confidence)
           VALUES (?, ?, ?, ?, '[]', ?, 0.7)`,
          crypto.randomUUID(), row.id, match[1].trim(), match[2].trim(), row.request_type,
          (err: any) => err ? rej(err) : res()
        )
      })
      
      console.log(`✅ ${row.id}`)
    } catch (e: any) {
      console.log(`❌ ${row.id}: ${e.message}`)
    }
  }
  
  const count: any[] = await new Promise((res, rej) => {
    conn.all('SELECT COUNT(*) as cnt FROM templates', (err, rows) => err ? rej(err) : res(rows))
  })
  console.log(`Total: ${count[0]?.cnt}`)
  conn.close(); db.close()
}
main()
