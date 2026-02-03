import { initializeAxiom, log } from '../../../core/src/observability/axiom'
import { type Redis, getRedis } from '../../../core/src/redis/client'

export interface ThreadContext {
  threadTs: string
  channelId: string
  conversationId: string
  currentDraft: string
  draftVersion: number
  customerId?: string
  createdAt: Date
  lastActivityAt: Date
  ttlSeconds: number
}

interface StoredThreadContext {
  threadTs: string
  channelId: string
  conversationId: string
  currentDraft: string
  draftVersion: number
  customerId?: string
  createdAt: string
  lastActivityAt: string
  ttlSeconds: number
}

export interface ThreadContextDeps {
  redis?: Redis
  logger?: typeof log
  initializeAxiom?: typeof initializeAxiom
  now?: () => Date
}

export type ThreadContextLookup =
  | { status: 'active'; context: ThreadContext }
  | { status: 'missing' }
  | { status: 'stale'; message: string }
  | { status: 'error'; message: string }

export type ThreadContextWriteResult =
  | { status: 'ok'; context?: ThreadContext }
  | { status: 'error'; message: string }

export const DEFAULT_THREAD_CONTEXT_TTL_SECONDS = 60 * 60
export const STALE_THREAD_MESSAGE =
  'This thread has expired. Please start a new conversation.'

const THREAD_CONTEXT_KEY_PREFIX = 'slack:thread-context:'

function getNow(deps?: ThreadContextDeps): Date {
  return deps?.now ? deps.now() : new Date()
}

function getLogger(deps?: ThreadContextDeps): typeof log {
  return deps?.logger ?? log
}

function getInitializer(deps?: ThreadContextDeps): typeof initializeAxiom {
  return deps?.initializeAxiom ?? initializeAxiom
}

function getRedisClient(deps?: ThreadContextDeps): Redis {
  return deps?.redis ?? getRedis()
}

function buildThreadContextKey(threadTs: string): string {
  return `${THREAD_CONTEXT_KEY_PREFIX}${threadTs}`
}

function serializeThreadContext(context: ThreadContext): StoredThreadContext {
  return {
    threadTs: context.threadTs,
    channelId: context.channelId,
    conversationId: context.conversationId,
    currentDraft: context.currentDraft,
    draftVersion: context.draftVersion,
    customerId: context.customerId,
    createdAt: context.createdAt.toISOString(),
    lastActivityAt: context.lastActivityAt.toISOString(),
    ttlSeconds: context.ttlSeconds,
  }
}

function parseThreadContext(data: unknown): ThreadContext | null {
  if (!data) return null

  try {
    const stored: StoredThreadContext =
      typeof data === 'string'
        ? (JSON.parse(data) as StoredThreadContext)
        : (data as StoredThreadContext)

    return {
      threadTs: stored.threadTs,
      channelId: stored.channelId,
      conversationId: stored.conversationId,
      currentDraft: stored.currentDraft,
      draftVersion: stored.draftVersion,
      customerId: stored.customerId,
      createdAt: new Date(stored.createdAt),
      lastActivityAt: new Date(stored.lastActivityAt),
      ttlSeconds: stored.ttlSeconds,
    }
  } catch {
    return null
  }
}

function isThreadContextStale(context: ThreadContext, now: Date): boolean {
  const ttlMs = context.ttlSeconds * 1000
  return now.getTime() - context.lastActivityAt.getTime() > ttlMs
}

async function logEvent(
  deps: ThreadContextDeps | undefined,
  level: Parameters<typeof log>[0],
  event: string,
  payload: Record<string, unknown>
): Promise<void> {
  const initialize = getInitializer(deps)
  const logger = getLogger(deps)
  initialize()
  await logger(level, event, payload)
}

export function createThreadContext(input: {
  threadTs: string
  channelId: string
  conversationId: string
  currentDraft: string
  draftVersion: number
  customerId?: string
  ttlSeconds?: number
  now?: () => Date
}): ThreadContext {
  const now = input.now ? input.now() : new Date()
  return {
    threadTs: input.threadTs,
    channelId: input.channelId,
    conversationId: input.conversationId,
    currentDraft: input.currentDraft,
    draftVersion: input.draftVersion,
    customerId: input.customerId,
    createdAt: now,
    lastActivityAt: now,
    ttlSeconds: input.ttlSeconds ?? DEFAULT_THREAD_CONTEXT_TTL_SECONDS,
  }
}

export async function setThreadContext(
  context: ThreadContext,
  deps?: ThreadContextDeps
): Promise<ThreadContextWriteResult> {
  const now = getNow(deps)
  const normalized: ThreadContext = {
    ...context,
    createdAt: context.createdAt ?? now,
    lastActivityAt: context.lastActivityAt ?? now,
    ttlSeconds: context.ttlSeconds ?? DEFAULT_THREAD_CONTEXT_TTL_SECONDS,
  }

  try {
    const redis = getRedisClient(deps)
    const key = buildThreadContextKey(context.threadTs)
    const stored = JSON.stringify(serializeThreadContext(normalized))
    await redis.set(key, stored, { ex: normalized.ttlSeconds })

    await logEvent(deps, 'info', 'slack.thread_context_set', {
      threadTs: normalized.threadTs,
      channelId: normalized.channelId,
      conversationId: normalized.conversationId,
      ttlSeconds: normalized.ttlSeconds,
    })

    return { status: 'ok', context: normalized }
  } catch (error) {
    await logEvent(deps, 'error', 'slack.thread_context_error', {
      threadTs: context.threadTs,
      operation: 'set',
      message: (error as Error)?.message,
    })

    return {
      status: 'error',
      message: 'Failed to store thread context.',
    }
  }
}

export async function getThreadContext(
  threadTs: string,
  deps?: ThreadContextDeps
): Promise<ThreadContextLookup> {
  try {
    const redis = getRedisClient(deps)
    const key = buildThreadContextKey(threadTs)
    const data = await redis.get<string>(key)
    const context = parseThreadContext(data)

    if (!context) {
      await logEvent(deps, 'info', 'slack.thread_context_get', {
        threadTs,
        status: 'missing',
      })
      return { status: 'missing' }
    }

    const now = getNow(deps)
    if (isThreadContextStale(context, now)) {
      await redis.del(key)
      await logEvent(deps, 'info', 'slack.thread_context_stale', {
        threadTs,
        conversationId: context.conversationId,
      })
      return { status: 'stale', message: STALE_THREAD_MESSAGE }
    }

    await logEvent(deps, 'info', 'slack.thread_context_get', {
      threadTs,
      status: 'active',
      conversationId: context.conversationId,
    })

    return { status: 'active', context }
  } catch (error) {
    await logEvent(deps, 'error', 'slack.thread_context_error', {
      threadTs,
      operation: 'get',
      message: (error as Error)?.message,
    })

    return {
      status: 'error',
      message: 'Failed to load thread context.',
    }
  }
}

export async function clearThreadContext(
  threadTs: string,
  deps?: ThreadContextDeps
): Promise<ThreadContextWriteResult> {
  try {
    const redis = getRedisClient(deps)
    const key = buildThreadContextKey(threadTs)
    await redis.del(key)

    await logEvent(deps, 'info', 'slack.thread_context_clear', {
      threadTs,
    })

    return { status: 'ok' }
  } catch (error) {
    await logEvent(deps, 'error', 'slack.thread_context_error', {
      threadTs,
      operation: 'clear',
      message: (error as Error)?.message,
    })

    return {
      status: 'error',
      message: 'Failed to clear thread context.',
    }
  }
}

export function shouldClearThreadContext(text: string): boolean {
  const normalized = text.trim().toLowerCase()
  if (!normalized) return false

  if (/\bnew topic\b/.test(normalized)) return true
  if (/\bdifferent customer\b/.test(normalized)) return true
  if (/\bnew customer\b/.test(normalized)) return true

  return false
}

export const _internal = {
  buildThreadContextKey,
  serializeThreadContext,
  parseThreadContext,
  isThreadContextStale,
}
