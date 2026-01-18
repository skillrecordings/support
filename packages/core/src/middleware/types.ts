/**
 * Middleware types for the support platform
 */

export interface RateLimitConfig {
  /**
   * Time window in milliseconds
   */
  windowMs: number
  /**
   * Maximum requests allowed within the window
   */
  maxRequests: number
}

export interface RateLimitResult {
  /**
   * Whether the request is allowed
   */
  allowed: boolean
  /**
   * Remaining requests in current window
   */
  remaining: number
  /**
   * Seconds until the rate limit resets (only present when blocked)
   */
  retryAfter?: number
  /**
   * Timestamp when the window resets
   */
  resetAt?: number
}

export interface RateLimiter {
  /**
   * Check if a request is allowed for the given key
   */
  check(key: string): RateLimitResult
}

export interface MiddlewareContext {
  appId: string
  userId?: string
  conversationId?: string
}

export type NextFunction = () => Promise<Response>

export type Middleware = (
  req: Request,
  context: MiddlewareContext,
  next: NextFunction
) => Promise<Response>
