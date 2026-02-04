import { ConversationsTable, desc, getDb, sql } from '@skillrecordings/database'
import { program } from 'commander'
import { type CommandContext, createContext } from '../core/context'
import { DatabaseError, formatError } from '../core/errors'

const DEFAULT_TIMEOUT_MS = 5000

const createAbortPromise = (signal: AbortSignal): Promise<never> =>
  new Promise((_, reject) => {
    if (signal.aborted) {
      reject(signal.reason ?? new Error('Operation aborted'))
      return
    }

    const onAbort = () => {
      signal.removeEventListener('abort', onAbort)
      reject(signal.reason ?? new Error('Operation aborted'))
    }

    signal.addEventListener('abort', onAbort)
  })

const resolveTimeoutMs = (ctx: CommandContext): number => {
  const value = ctx.config.dbStatusTimeoutMs
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed
    }
  }
  return DEFAULT_TIMEOUT_MS
}

const writeLine = (ctx: CommandContext, line = ''): void => {
  ctx.stdout.write(`${line}\n`)
}

const writeError = (ctx: CommandContext, error: DatabaseError): void => {
  ctx.stderr.write(`${formatError(error)}\n`)
  process.exitCode = error.exitCode
}

export async function dbStatus(ctx: CommandContext): Promise<void> {
  const timeoutMs = resolveTimeoutMs(ctx)
  const timeoutSignal = AbortSignal.timeout(timeoutMs)
  const combinedSignal = AbortSignal.any([ctx.signal, timeoutSignal])

  const runWithSignal = async <T>(promise: Promise<T>): Promise<T> =>
    Promise.race([promise, createAbortPromise(combinedSignal)])

  try {
    const db = getDb()

    const statusCounts = await runWithSignal(
      db
        .select({
          status: ConversationsTable.status,
          count: sql<number>`COUNT(*)`.as('count'),
        })
        .from(ConversationsTable)
        .groupBy(ConversationsTable.status)
    )

    writeLine(ctx, 'Conversation counts by status:')
    for (const row of statusCounts) {
      writeLine(ctx, `  ${row.status}: ${row.count}`)
    }

    const recent = await runWithSignal(
      db
        .select()
        .from(ConversationsTable)
        .orderBy(desc(ConversationsTable.updated_at))
        .limit(5)
    )

    writeLine(ctx)
    writeLine(ctx, 'Recent conversations:')
    for (const conversation of recent) {
      writeLine(
        ctx,
        `  ${conversation.front_conversation_id}: ${conversation.status} (${conversation.updated_at})`
      )
    }
  } catch (error) {
    if (error instanceof DatabaseError) {
      writeError(ctx, error)
      return
    }

    const isTimeout = timeoutSignal.aborted
    const dbError = new DatabaseError({
      userMessage: isTimeout
        ? 'Database request timed out.'
        : 'Database connection failed.',
      suggestion: isTimeout
        ? `Try again or increase the timeout (currently ${timeoutMs}ms).`
        : 'Verify DATABASE_URL and ensure the database is reachable.',
      cause: error,
    })

    writeError(ctx, dbError)
  }
}

export const registerDbStatusCommand = (prog: typeof program) => {
  prog
    .command('db-status')
    .description('Check database status and conversation counts')
    .action(async () => {
      const ctx = createContext()
      await dbStatus(ctx)
    })
}
