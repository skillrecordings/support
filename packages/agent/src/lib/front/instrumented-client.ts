import { log } from '@skillrecordings/core/observability/axiom'
import {
  ErrorResponseSchema,
  FRONT_API_BASE,
  FrontApiError,
  type FrontClientConfig,
} from '@skillrecordings/front-sdk'
import { z } from 'zod'
import { createChannelsClient } from '../../../../front-sdk/src/client/channels'
import { createContactsClient } from '../../../../front-sdk/src/client/contacts'
import { createConversationsClient } from '../../../../front-sdk/src/client/conversations'
import { createDraftsClient } from '../../../../front-sdk/src/client/drafts'
import { createInboxesClient } from '../../../../front-sdk/src/client/inboxes'
import { createMessagesClient } from '../../../../front-sdk/src/client/messages'
import { createTagsClient } from '../../../../front-sdk/src/client/tags'
import { createTeammatesClient } from '../../../../front-sdk/src/client/teammates'
import { createTemplatesClient } from '../../../../front-sdk/src/client/templates'

const REQUEST_ID_HEADERS = [
  'x-request-id',
  'x-front-request-id',
  'x-amzn-requestid',
  'x-amz-request-id',
]

function extractRequestId(headers: Headers): string | undefined {
  for (const header of REQUEST_ID_HEADERS) {
    const value = headers.get(header)
    if (value) return value
  }
  return undefined
}

function detectFieldPresence(data: unknown): {
  hasLinksRelatedChildren: boolean
  hasHighlights: boolean
} {
  let hasLinksRelatedChildren = false
  let hasHighlights = false

  const checkObject = (value: unknown) => {
    if (!value || typeof value !== 'object') return
    const record = value as Record<string, unknown>
    if (
      !hasHighlights &&
      Object.prototype.hasOwnProperty.call(record, 'highlights')
    ) {
      hasHighlights = true
    }

    if (!hasLinksRelatedChildren) {
      const links = record._links
      if (links && typeof links === 'object') {
        const related = (links as Record<string, unknown>).related
        if (related && typeof related === 'object') {
          if (Object.prototype.hasOwnProperty.call(related, 'children')) {
            hasLinksRelatedChildren = true
          }
        }
      }
    }
  }

  checkObject(data)

  if (data && typeof data === 'object') {
    const results = (data as Record<string, unknown>)._results
    if (Array.isArray(results)) {
      for (const item of results) {
        checkObject(item)
        if (hasLinksRelatedChildren && hasHighlights) break
      }
    }
  }

  return { hasLinksRelatedChildren, hasHighlights }
}

async function logFrontRequest(options: {
  level: 'info' | 'warn' | 'error'
  method: string
  endpoint: string
  statusCode: number
  durationMs: number
  requestId?: string
  hasLinksRelatedChildren?: boolean
  hasHighlights?: boolean
  errorMessage?: string
}) {
  await log(options.level, 'Front API request', {
    endpoint: options.endpoint,
    method: options.method,
    httpStatus: options.statusCode,
    durationMs: options.durationMs,
    requestId: options.requestId,
    hasLinksRelatedChildren: options.hasLinksRelatedChildren,
    hasHighlights: options.hasHighlights,
    errorMessage: options.errorMessage,
  })
}

async function handleRateLimit(
  response: Response,
  attempt: number
): Promise<number> {
  const retryAfter = response.headers.get('Retry-After')
  return retryAfter
    ? parseInt(retryAfter, 10) * 1000
    : Math.min(1000 * Math.pow(2, attempt), 30000)
}

export function createInstrumentedBaseClient(config: FrontClientConfig) {
  const baseUrl = config.baseUrl ?? FRONT_API_BASE
  const headers = {
    Authorization: `Bearer ${config.apiToken}`,
    'Content-Type': 'application/json',
  }

  async function request<T>(
    method: string,
    path: string,
    schema?: z.ZodType<T>,
    body?: unknown,
    maxRetries = 3
  ): Promise<T> {
    const endpoint = path.startsWith('http') ? path : `${baseUrl}${path}`
    const startTime = Date.now()
    let lastRequestId: string | undefined

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      let response: Response
      try {
        response = await fetch(endpoint, {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
        })
      } catch (error) {
        const durationMs = Date.now() - startTime
        await logFrontRequest({
          level: 'error',
          method,
          endpoint: path,
          statusCode: 0,
          durationMs,
          errorMessage: error instanceof Error ? error.message : String(error),
        })
        throw error
      }

      lastRequestId = extractRequestId(response.headers)

      if (response.status === 429) {
        const delay = await handleRateLimit(response, attempt)
        await new Promise((resolve) => setTimeout(resolve, delay))
        continue
      }

      const durationMs = Date.now() - startTime

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        const parsed = ErrorResponseSchema.safeParse(errorData)
        const errorMessage = parsed.success
          ? parsed.data._error.message
          : response.statusText

        await logFrontRequest({
          level: 'error',
          method,
          endpoint: path,
          statusCode: response.status,
          durationMs,
          requestId: lastRequestId,
          errorMessage,
        })

        if (parsed.success) {
          const { status, title, message, details } = parsed.data._error
          throw new FrontApiError(status, title, message, details)
        }
        throw new FrontApiError(
          response.status,
          'Unknown Error',
          response.statusText
        )
      }

      if (response.status === 204) {
        await logFrontRequest({
          level: 'info',
          method,
          endpoint: path,
          statusCode: response.status,
          durationMs,
          requestId: lastRequestId,
          hasLinksRelatedChildren: false,
          hasHighlights: false,
        })
        return undefined as T
      }

      const data = await response.json()
      const fieldPresence = detectFieldPresence(data)

      await logFrontRequest({
        level: 'info',
        method,
        endpoint: path,
        statusCode: response.status,
        durationMs,
        requestId: lastRequestId,
        hasLinksRelatedChildren: fieldPresence.hasLinksRelatedChildren,
        hasHighlights: fieldPresence.hasHighlights,
      })

      if (schema) {
        return schema.parse(data)
      }
      return data as T
    }

    const durationMs = Date.now() - startTime
    await logFrontRequest({
      level: 'error',
      method,
      endpoint: path,
      statusCode: 429,
      durationMs,
      requestId: lastRequestId,
      errorMessage: 'Max retries exceeded',
    })

    throw new FrontApiError(429, 'Rate Limited', 'Max retries exceeded')
  }

  return {
    get: <T>(path: string, schema?: z.ZodType<T>) =>
      request<T>('GET', path, schema),
    post: <T>(path: string, body: unknown, schema?: z.ZodType<T>) =>
      request<T>('POST', path, schema, body),
    patch: <T>(path: string, body: unknown, schema?: z.ZodType<T>) =>
      request<T>('PATCH', path, schema, body),
    put: <T>(path: string, body: unknown, schema?: z.ZodType<T>) =>
      request<T>('PUT', path, schema, body),
    delete: <T>(path: string, schema?: z.ZodType<T>) =>
      request<T>('DELETE', path, schema),
  }
}

export function createInstrumentedFrontClient(config: FrontClientConfig) {
  const baseClient = createInstrumentedBaseClient(config)

  return {
    raw: baseClient,
    conversations: createConversationsClient(baseClient),
    messages: createMessagesClient(baseClient),
    drafts: createDraftsClient(baseClient),
    templates: createTemplatesClient(baseClient),
    tags: createTagsClient(baseClient),
    inboxes: createInboxesClient(baseClient),
    channels: createChannelsClient(baseClient),
    contacts: createContactsClient(baseClient),
    teammates: createTeammatesClient(baseClient),
  }
}

export type InstrumentedFrontClient = ReturnType<
  typeof createInstrumentedFrontClient
>
