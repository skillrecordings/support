/**
 * Extract templates from gold conversations using Vercel AI Gateway
 */
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { execSync } from 'child_process'
import { createAnthropic } from '@ai-sdk/anthropic'
import { generateText } from 'ai'
import Database from 'duckdb'

const DB_PATH = path.resolve('gold.duckdb')
const MODEL = 'claude-3-haiku-[PHONE]'
const BATCH_SIZE = 5
const BATCH_DELAY_MS = 150

// Use Vercel AI Gateway
const AI_GATEWAY_API_KEY = process.env.AI_GATEWAY_API_KEY
if (!AI_GATEWAY_API_KEY) {
  console.error('ERROR: AI_GATEWAY_API_KEY not set')
  process.exit(1)
}

const anthropic = createAnthropic({
  baseURL: 'https://ai-gateway.vercel.sh/v1',
  apiKey: AI_GATEWAY_API_KEY,
})

type ThreadMessage = {
  direction: 'in' | 'out'
  body: string
  timestamp: number
  subject?: string
}

type ConversationRow = {
  id: string
  request_type: string
  subject: string | null
  trigger_message: unknown
  conversation_history: unknown
}

type TemplateOutput = {
  pattern: string
  template: string
  variables: Array<{ name: string; source: 'customer_message' | 'purchase_data' | 'config' }>
  confidence: number
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback
  if (typeof value === 'object') return value as T
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T
    } catch {
      return fallback
    }
  }
  return fallback
}

function toThreadMessage(entry: {
  direction?: 'in' | 'out'
  body?: string
  timestamp?: number
  subject?: string
}): ThreadMessage | null {
  if (!entry?.body || !entry?.timestamp) return null
  return {
    direction: entry.direction ?? 'in',
    body: entry.body,
    timestamp: entry.timestamp,
    subject: entry.subject,
  }
}

function buildTranscript(row: ConversationRow): ThreadMessage[] {
  const trigger = parseJson<{
    body?: string
    timestamp?: number
    subject?: string
  }>(row.trigger_message, {})
  const history = parseJson<
    Array<{ direction?: 'in' | 'out'; body?: string; timestamp?: number }>
  >(row.conversation_history, [])

  const messages: ThreadMessage[] = []
  const seen = new Set<string>()

  for (const entry of history) {
    const message = toThreadMessage(entry)
    if (!message) continue
    const key = `${message.timestamp}|${message.body}`
    if (seen.has(key)) continue
    seen.add(key)
    messages.push(message)
  }

  const triggerMessage = toThreadMessage({
    direction: 'in',
    body: trigger.body,
    timestamp: trigger.timestamp,
    subject: trigger.subject ?? row.subject ?? undefined,
  })

  if (triggerMessage) {
    const key = `${triggerMessage.timestamp}|${triggerMessage.body}`
    if (!seen.has(key)) {
      seen.add(key)
      messages.push(triggerMessage)
    }
  }

  messages.sort((a, b) => a.timestamp - b.timestamp)
  return messages
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value
  return `${value.slice(0, maxChars)}…`
}

function renderTranscript(messages: ThreadMessage[]): string {
  return messages
    .map((message) => {
      const role = message.direction === 'in' ? 'customer' : 'support'
      const body = truncate(message.body.trim(), 1200)
      return `${role}: ${body}`
    })
    .join('\n')
}

function extractJson(text: string): TemplateOutput {
  const trimmed = text.trim()
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('LLM response did not include JSON')
  }
  const jsonText = trimmed.slice(start, end + 1)
  const parsed = JSON.parse(jsonText) as TemplateOutput
  if (!parsed.pattern || !parsed.template) {
    throw new Error('LLM response missing required fields')
  }
  if (!Array.isArray(parsed.variables)) {
    parsed.variables = []
  }
  if (typeof parsed.confidence !== 'number') {
    parsed.confidence = 0.8
  }
  return parsed
}

async function extractTemplate(row: ConversationRow): Promise<TemplateOutput | null> {
  const transcript = renderTranscript(buildTranscript(row))
  
  if (!transcript.trim()) {
    console.log(`  Skipping ${row.id}: empty transcript`)
    return null
  }

  const prompt = `You extract reusable support response templates.

Category: ${row.request_type}

Transcript:
${transcript}

Return ONLY valid JSON:
{
  "pattern": "short description of customer request",
  "template": "reusable support reply with {{variables}}",
  "variables": [{"name": "varname", "source": "customer_message|purchase_data|config"}],
  "confidence": 0.0-1.0
}

Rules:
- Base template on what the human support agent said, generalized
- Use {{variables}} for names, emails, order IDs, dates, amounts
- Keep template concise (1-5 sentences)
- Output JSON only, no markdown`

  try {
    const { text } = await generateText({
      model: anthropic(MODEL),
      maxTokens: 400,
      prompt,
    })
    return extractJson(text)
  } catch (e) {
    console.error(`  Error extracting ${row.id}:`, e)
    return null
  }
}

async function main(): Promise<void> {
  console.log('=== Template Extraction (Vercel AI Gateway) ===')
  
  const db = new Database.Database(DB_PATH)
  const connection = db.connect()

  const runQuery = (sql: string): Promise<void> =>
    new Promise((resolve, reject) => {
      connection.run(sql, (err: Error | null) => {
        if (err) reject(err)
        else resolve()
      })
    })

  const allQuery = <T>(sql: string): Promise<T[]> =>
    new Promise((resolve, reject) => {
      connection.all(sql, (err: Error | null, rows: T[]) => {
        if (err) reject(err)
        else resolve(rows)
      })
    })

  // Ensure templates table exists
  await runQuery(`
    CREATE TABLE IF NOT EXISTS templates (
      id VARCHAR PRIMARY KEY,
      conversation_id VARCHAR NOT NULL,
      pattern VARCHAR NOT NULL,
      template VARCHAR NOT NULL,
      variables JSON NOT NULL,
      category VARCHAR NOT NULL,
      confidence DOUBLE NOT NULL
    );
  `)

  // Clear existing templates for gold conversations
  await runQuery(`DELETE FROM templates WHERE conversation_id IN (SELECT id FROM conversations WHERE is_gold = true);`)

  const rows = await allQuery<ConversationRow>(`
    SELECT id, request_type, subject, trigger_message, conversation_history
    FROM conversations
    WHERE is_gold = true
    ORDER BY id
  `)

  console.log(`Found ${rows.length} gold conversations`)

  if (rows.length === 0) {
    console.log('No gold conversations found.')
    connection.close()
    db.close()
    return
  }

  const insertStatement = connection.prepare(
    'INSERT INTO templates (id, conversation_id, pattern, template, variables, category, confidence) VALUES (?, ?, ?, ?, CAST(? AS JSON), ?, ?)'
  )

  const runInsert = (
    id: string,
    conversationId: string,
    pattern: string,
    template: string,
    variables: string,
    category: string,
    confidence: number
  ): Promise<void> =>
    new Promise((resolve, reject) => {
      insertStatement.run(id, conversationId, pattern, template, variables, category, confidence, (err: Error | null) => {
        if (err) reject(err)
        else resolve()
      })
    })

  let processed = 0
  let extracted = 0

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE)

    const results = await Promise.all(
      batch.map(async (row) => {
        const template = await extractTemplate(row)
        return template ? { row, template } : null
      })
    )

    for (const result of results) {
      processed++
      if (!result) continue

      const { row, template } = result
      const allowedSources = new Set(['customer_message', 'purchase_data', 'config'])
      const variables = template.variables
        .filter((v) => v && typeof v.name === 'string')
        .map((v) => ({
          name: v.name,
          source: allowedSources.has(v.source) ? v.source : 'customer_message',
        }))

      await runInsert(
        crypto.randomUUID(),
        row.id,
        template.pattern,
        template.template,
        JSON.stringify(variables),
        row.request_type,
        Math.min(1, Math.max(0, template.confidence))
      )
      extracted++
      console.log(`[${processed}/${rows.length}] ${row.id} → ${template.pattern.slice(0, 50)}...`)
    }

    if (i + BATCH_SIZE < rows.length) {
      await sleep(BATCH_DELAY_MS)
    }
  }

  const countRows = await allQuery<{ count: number }>('SELECT COUNT(*)::INTEGER AS count FROM templates')
  const total = countRows[0]?.count ?? 0
  
  console.log(`\n=== Done ===`)
  console.log(`Processed: ${processed}`)
  console.log(`Extracted: ${extracted}`)
  console.log(`Templates in DB: ${total}`)

  // Notify via Moltbot CLI if templates were extracted
  if (extracted > 0) {
    try {
      const message = `📋 ${extracted} templates ready for review\n→ https://clanker-001.tail7af24.ts.net:3443`
      execSync(`moltbot message send --channel telegram --target [PHONE] --message "${message.replace(/"/g, '\\"')}"`, {
        stdio: 'inherit'
      })
      console.log('Moltbot notification sent')
    } catch (e) {
      console.error('Failed to send Moltbot notification:', e)
    }
  }

  connection.close()
  db.close()
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
