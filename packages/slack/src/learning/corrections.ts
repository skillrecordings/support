import { initializeAxiom, log } from '../../../core/src/observability/axiom'
import { type Redis, getRedis } from '../../../core/src/redis/client'

export interface CorrectionEvent {
  conversationId: string
  originalDraft: string
  revisedDraft: string
  refinementType: string
  userId: string
  timestamp: Date
  threadTs: string
}

interface StoredCorrectionEvent {
  conversationId: string
  originalDraft: string
  revisedDraft: string
  refinementType: string
  userId: string
  timestamp: string
  threadTs: string
}

export interface CorrectionEventDeps {
  redis?: Redis
  logger?: typeof log
  initializeAxiom?: typeof initializeAxiom
}

export type CorrectionEventWriteResult =
  | { status: 'ok'; event: CorrectionEvent }
  | { status: 'error'; message: string }

const CORRECTION_KEY_PREFIX = 'slack:corrections'
const CORRECTION_KEY_ALL = `${CORRECTION_KEY_PREFIX}:all`

function getLogger(deps?: CorrectionEventDeps): typeof log {
  return deps?.logger ?? log
}

function getInitializer(deps?: CorrectionEventDeps): typeof initializeAxiom {
  return deps?.initializeAxiom ?? initializeAxiom
}

function getRedisClient(deps?: CorrectionEventDeps): Redis {
  return deps?.redis ?? getRedis()
}

function buildConversationKey(conversationId: string): string {
  return `${CORRECTION_KEY_PREFIX}:conversation:${conversationId}`
}

function serializeCorrectionEvent(
  event: CorrectionEvent
): StoredCorrectionEvent {
  return {
    conversationId: event.conversationId,
    originalDraft: event.originalDraft,
    revisedDraft: event.revisedDraft,
    refinementType: event.refinementType,
    userId: event.userId,
    timestamp: event.timestamp.toISOString(),
    threadTs: event.threadTs,
  }
}

function parseCorrectionEvent(data: unknown): CorrectionEvent | null {
  if (!data) return null

  try {
    const stored: StoredCorrectionEvent =
      typeof data === 'string'
        ? (JSON.parse(data) as StoredCorrectionEvent)
        : (data as StoredCorrectionEvent)

    return {
      conversationId: stored.conversationId,
      originalDraft: stored.originalDraft,
      revisedDraft: stored.revisedDraft,
      refinementType: stored.refinementType,
      userId: stored.userId,
      timestamp: new Date(stored.timestamp),
      threadTs: stored.threadTs,
    }
  } catch {
    return null
  }
}

async function logEvent(
  deps: CorrectionEventDeps | undefined,
  level: Parameters<typeof log>[0],
  event: string,
  payload: Record<string, unknown>
): Promise<void> {
  const initialize = getInitializer(deps)
  const logger = getLogger(deps)
  initialize()
  await logger(level, event, payload)
}

export async function recordCorrectionEvent(
  event: CorrectionEvent,
  deps?: CorrectionEventDeps
): Promise<CorrectionEventWriteResult> {
  try {
    const redis = getRedisClient(deps)
    const stored = JSON.stringify(serializeCorrectionEvent(event))

    await redis.lpush(CORRECTION_KEY_ALL, stored)
    await redis.lpush(buildConversationKey(event.conversationId), stored)

    await logEvent(deps, 'info', 'slack.correction_captured', {
      conversationId: event.conversationId,
      threadTs: event.threadTs,
      refinementType: event.refinementType,
      userId: event.userId,
    })

    return { status: 'ok', event }
  } catch (error) {
    await logEvent(deps, 'error', 'slack.correction_error', {
      conversationId: event.conversationId,
      threadTs: event.threadTs,
      operation: 'record',
      message: (error as Error)?.message,
    })

    return {
      status: 'error',
      message: 'Failed to store correction event.',
    }
  }
}

export async function listCorrectionEvents(
  limit = 50,
  deps?: CorrectionEventDeps
): Promise<CorrectionEvent[]> {
  try {
    const redis = getRedisClient(deps)
    const results = await redis.lrange(CORRECTION_KEY_ALL, 0, limit - 1)
    return results
      .map(parseCorrectionEvent)
      .filter((event): event is CorrectionEvent => Boolean(event))
  } catch {
    return []
  }
}

export async function listCorrectionsForConversation(
  conversationId: string,
  limit = 50,
  deps?: CorrectionEventDeps
): Promise<CorrectionEvent[]> {
  try {
    const redis = getRedisClient(deps)
    const results = await redis.lrange(
      buildConversationKey(conversationId),
      0,
      limit - 1
    )
    return results
      .map(parseCorrectionEvent)
      .filter((event): event is CorrectionEvent => Boolean(event))
  } catch {
    return []
  }
}

export const _internal = {
  buildConversationKey,
  serializeCorrectionEvent,
  parseCorrectionEvent,
}
