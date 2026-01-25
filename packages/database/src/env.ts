import { createEnv } from '@t3-oss/env-core'
import { z } from 'zod'

/**
 * Check if we should skip validation.
 * Skip during:
 * - Tests (VITEST, NODE_ENV=test)
 * - CI builds
 * - Build time (NEXT_PHASE is set during Next.js build)
 * - Explicit skip
 */
const shouldSkipValidation =
  typeof process !== 'undefined' &&
  (!!process.env.VITEST ||
    process.env.NODE_ENV === 'test' ||
    !!process.env.CI ||
    !!process.env.SKIP_ENV_VALIDATION ||
    process.env.NEXT_PHASE === 'phase-production-build')

export const env = createEnv({
  server: {
    DATABASE_URL: z.string().url(),
  },
  runtimeEnv: process.env,
  skipValidation: shouldSkipValidation,
})
