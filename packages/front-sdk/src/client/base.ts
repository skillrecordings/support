import { z } from 'zod'
import { ErrorResponseSchema } from '../schemas/common'

export const FRONT_API_BASE = 'https://api2.frontapp.com'

/**
 * Configuration for the Front API client
 */
export interface FrontClientConfig {
  /** API token for authentication (required) */
  apiToken: string
  /** Optional base URL override (defaults to https://api2.frontapp.com) */
  baseUrl?: string
}

/**
 * Custom error class for Front API errors
 * Provides structured error information from the API
 */
export class FrontApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly title: string,
    message: string,
    public readonly details?: string[]
  ) {
    super(message)
    this.name = 'FrontApiError'
  }
}

/**
 * Handle rate limiting with exponential backoff
 * Uses Retry-After header if present, otherwise exponential backoff
 */
async function handleRateLimit(
  response: Response,
  attempt: number
): Promise<number> {
  const retryAfter = response.headers.get('Retry-After')
  const delay = retryAfter
    ? parseInt(retryAfter, 10) * 1000
    : Math.min(1000 * Math.pow(2, attempt), 30000)
  return delay
}

/**
 * Create a base HTTP client with authentication and error handling
 * Includes automatic retry logic for 429 rate limit responses
 */
export function createBaseClient(config: FrontClientConfig) {
  const baseUrl = config.baseUrl ?? FRONT_API_BASE
  const headers = {
    Authorization: `Bearer ${config.apiToken}`,
    'Content-Type': 'application/json',
  }

  /**
   * Generic request handler with retry logic and error handling
   */
  async function request<T>(
    method: string,
    path: string,
    schema?: z.ZodType<T>,
    body?: unknown,
    maxRetries = 3
  ): Promise<T> {
    const url = path.startsWith('http') ? path : `${baseUrl}${path}`

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      })

      // Handle rate limiting (429) with exponential backoff
      if (response.status === 429) {
        const delay = await handleRateLimit(response, attempt)
        await new Promise((r) => setTimeout(r, delay))
        continue
      }

      // Handle error responses
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        const parsed = ErrorResponseSchema.safeParse(errorData)
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

      // Handle empty responses (204 No Content)
      if (response.status === 204) {
        return undefined as T
      }

      const data = await response.json()

      // Validate response with schema if provided
      if (schema) {
        return schema.parse(data)
      }
      return data as T
    }

    throw new FrontApiError(429, 'Rate Limited', 'Max retries exceeded')
  }

  return {
    /**
     * Send a GET request
     */
    get: <T>(path: string, schema?: z.ZodType<T>) =>
      request<T>('GET', path, schema),

    /**
     * Send a POST request
     */
    post: <T>(path: string, body: unknown, schema?: z.ZodType<T>) =>
      request<T>('POST', path, schema, body),

    /**
     * Send a PATCH request
     */
    patch: <T>(path: string, body: unknown, schema?: z.ZodType<T>) =>
      request<T>('PATCH', path, schema, body),

    /**
     * Send a PUT request
     */
    put: <T>(path: string, body: unknown, schema?: z.ZodType<T>) =>
      request<T>('PUT', path, schema, body),

    /**
     * Send a DELETE request
     */
    delete: <T>(path: string, schema?: z.ZodType<T>) =>
      request<T>('DELETE', path, schema),
  }
}

/**
 * Type for the base client instance
 */
export type BaseClient = ReturnType<typeof createBaseClient>
