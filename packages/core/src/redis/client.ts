import { Redis } from '@upstash/redis'

let _redis: Redis | null = null

/**
 * Get Redis client singleton.
 * Lazy initialization - creates client on first call.
 */
export function getRedis(): Redis {
  if (!_redis) {
    const url = process.env.UPSTASH_REDIS_REST_URL
    const token = process.env.UPSTASH_REDIS_REST_TOKEN

    if (!url) {
      throw new Error('UPSTASH_REDIS_REST_URL environment variable is required')
    }
    if (!token) {
      throw new Error(
        'UPSTASH_REDIS_REST_TOKEN environment variable is required'
      )
    }

    _redis = new Redis({ url, token })
  }

  return _redis
}

/**
 * Reset Redis client singleton.
 * @internal For testing only
 */
export function resetRedis(): void {
  _redis = null
}

// Re-export Redis type for convenience
export { Redis }
