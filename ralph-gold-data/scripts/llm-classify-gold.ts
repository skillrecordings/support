import fs from 'fs'
import path from 'path'
type DuckDB = typeof import('duckdb')

type ThreadMessage = {
  direction: 'in' | 'out'
  body: string
  timestamp: number
  subject?: string
}

type ThreadClassifyInput = {
  conversationId: string
  appId: string
  messages: ThreadMessage[]
  triggerMessage: ThreadMessage
  instructorTeammateId?: string
  tags?: string[]
}

type ClassifyThread = (
  input: ThreadClassifyInput,
  options?: { forceLLM?: boolean }
) => Promise<{ category: string; confidence: number; reasoning?: string }>

const DB_PATH = path.resolve('gold.duckdb')
const REPORT_PATH = path.resolve('reports/llm-vs-heuristic.json')
const BATCH_SIZE = 5
const BATCH_DELAY_MS = 1200

type ConversationRow = {
  id: string
  product: string
  subject: string | null
  tags: unknown
  trigger_message: unknown
  conversation_history: unknown
  request_type: string
}

type LlmClassification = {
  category: string
  confidence: number
  reasoning?: string
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function loadEnvFile(filePath: string): void {
  if (!fs.existsSync(filePath)) return
  const contents = fs.readFileSync(filePath, 'utf8')
  for (const line of contents.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (!match) continue
    const key = match[1]
    let value = match[2] ?? ''
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (!process.env[key]) {
      process.env[key] = value
    }
  }
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

function buildThreadInput(row: ConversationRow): ThreadClassifyInput {
  const tags = parseJson<string[]>(row.tags, [])
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

  const selectedTrigger =
    (triggerMessage &&
      messages.find(
        (message) =>
          message.timestamp === triggerMessage.timestamp &&
          message.body === triggerMessage.body
      )) ??
    messages[0]

  if (!selectedTrigger) {
    throw new Error(`Missing trigger message for conversation ${row.id}`)
  }

  return {
    conversationId: row.id,
    appId: row.product,
    messages,
    triggerMessage: selectedTrigger,
    tags,
  }
}

async function loadDuckDB(): Promise<DuckDB> {
  const duckdb = await import('duckdb')
  return duckdb
}

function ensureWorkspaceCore(): void {
  const monorepoRoot = path.resolve('..')
  const target = path.join(monorepoRoot, 'packages', 'core')
  const scopeDir = path.resolve('node_modules', '@skillrecordings')
  const link = path.join(scopeDir, 'core')

  if (fs.existsSync(link)) return
  if (!fs.existsSync(target)) {
    throw new Error(`Missing workspace package at ${target}`)
  }

  fs.mkdirSync(scopeDir, { recursive: true })
  fs.symlinkSync(target, link, 'dir')
}

async function run(): Promise<void> {
  if (process.env.AI_GATEWAY_MOCK === '1') {
    throw new Error(
      'AI_GATEWAY_MOCK is set. Disable mock mode to run real LLM classifications.'
    )
  }

  if (!process.env.AI_GATEWAY_API_KEY && !process.env.ANTHROPIC_API_KEY) {
    const envPath = path.resolve('..', 'packages', 'cli', '.env.local')
    loadEnvFile(envPath)
  }

  if (!process.env.AI_GATEWAY_API_KEY && process.env.ANTHROPIC_API_KEY) {
    process.env.AI_GATEWAY_API_KEY = process.env.ANTHROPIC_API_KEY
  }

  if (!process.env.AI_GATEWAY_API_KEY) {
    throw new Error(
      'Missing AI_GATEWAY_API_KEY (or ANTHROPIC_API_KEY) for LLM classification.'
    )
  }

  ensureWorkspaceCore()
  const { classifyThread } = (await import(
    '@skillrecordings/core/pipeline/steps/classify'
  )) as { classifyThread: ClassifyThread }

  const duckdb = await loadDuckDB()
  const db = new duckdb.Database(DB_PATH)
  const connection = db.connect()

  const runQuery = (sql: string): Promise<void> =>
    new Promise((resolve, reject) => {
      connection.run(sql, (err: Error | null) => {
        if (err) reject(err)
        else resolve()
      })
    })

  const allQuery = <T>(sql: string, params: unknown[] = []): Promise<T[]> =>
    new Promise((resolve, reject) => {
      if (params.length > 0) {
        connection.all(sql, params, (err: Error | null, rows: T[]) => {
          if (err) reject(err)
          else resolve(rows)
        })
        return
      }
      connection.all(sql, (err: Error | null, rows: T[]) => {
        if (err) reject(err)
        else resolve(rows)
      })
    })

  await runQuery(
    'ALTER TABLE conversations ADD COLUMN IF NOT EXISTS llm_classification JSON;'
  )

  const rows = await allQuery<
    ConversationRow & { heuristic_request_type: string | null }
  >(
    `SELECT conversations.id,
            conversations.product,
            conversations.subject,
            conversations.tags,
            conversations.trigger_message,
            conversations.conversation_history,
            conversations.request_type,
            classifications.request_type AS heuristic_request_type
     FROM conversations
     LEFT JOIN classifications
       ON classifications.conversation_id = conversations.id
      AND classifications.classifier_version = 'heuristic-v1'
     WHERE conversations.is_gold = true
     ORDER BY conversations.id`
  )

  if (rows.length === 0) {
    console.log('No gold conversations found.')
    return
  }

  const comparisons: Array<{
    conversation_id: string
    product: string
    heuristic: string
    llm: string
    confidence: number
    reasoning: string | null
    matches: boolean
  }> = []

  let processed = 0
  const updateStatement = connection.prepare(
    'UPDATE conversations SET llm_classification = CAST(? AS JSON), request_type = ? WHERE id = ?'
  )
  const insertStatement = connection.prepare(
    'INSERT INTO classifications (conversation_id, request_type, confidence, classifier_version) VALUES (?, ?, ?, ?)'
  )

  await runQuery(
    "DELETE FROM classifications WHERE classifier_version = 'llm-haiku' AND conversation_id IN (SELECT id FROM conversations WHERE is_gold = true);"
  )

  const runUpdate = (
    jsonValue: string,
    requestType: string,
    id: string
  ): Promise<void> =>
    new Promise((resolve, reject) => {
      updateStatement.run(jsonValue, requestType, id, (err: Error | null) => {
        if (err) reject(err)
        else resolve()
      })
    })

  const runInsert = (
    conversationId: string,
    requestType: string,
    confidence: number,
    classifierVersion: string
  ): Promise<void> =>
    new Promise((resolve, reject) => {
      insertStatement.run(
        conversationId,
        requestType,
        confidence,
        classifierVersion,
        (err: Error | null) => {
          if (err) reject(err)
          else resolve()
        }
      )
    })

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE)
    for (const row of batch) {
      const input = buildThreadInput(row)
      const result = await classifyThread(input, { forceLLM: true })
      const llmClassification: LlmClassification = {
        category: result.category,
        confidence: result.confidence,
        reasoning: result.reasoning,
      }

      await runUpdate(
        JSON.stringify(llmClassification),
        result.category,
        row.id
      )
      await runInsert(
        row.id,
        result.category,
        result.confidence,
        'llm-haiku'
      )

      const heuristic =
        row.heuristic_request_type || row.request_type || 'unknown'
      comparisons.push({
        conversation_id: row.id,
        product: row.product,
        heuristic,
        llm: result.category,
        confidence: result.confidence,
        reasoning: result.reasoning ?? null,
        matches: heuristic === result.category,
      })

      processed += 1
      console.log(
        `[${processed}/${rows.length}] ${row.id} → ${result.category} (${result.confidence})`
      )
    }

    if (i + BATCH_SIZE < rows.length) {
      await sleep(BATCH_DELAY_MS)
    }
  }

  const summary = comparisons.reduce(
    (acc, row) => {
      acc.total += 1
      acc.matches += row.matches ? 1 : 0
      acc.mismatches += row.matches ? 0 : 1
      acc.heuristic[row.heuristic] =
        (acc.heuristic[row.heuristic] || 0) + 1
      acc.llm[row.llm] = (acc.llm[row.llm] || 0) + 1
      return acc
    },
    {
      total: 0,
      matches: 0,
      mismatches: 0,
      heuristic: {} as Record<string, number>,
      llm: {} as Record<string, number>,
    }
  )

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true })
  fs.writeFileSync(
    REPORT_PATH,
    JSON.stringify({ summary, comparisons }, null, 2)
  )

  console.log(`Report saved to ${REPORT_PATH}`)
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
