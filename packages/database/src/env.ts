import { createEnv } from '@t3-oss/env-core'
import { z } from 'zod'

export const env = createEnv({
  server: {
    DATABASE_URL: z.string().url(),
  },
  runtimeEnv: process.env,
  // Skip validation in test/build environments
  // - VITEST: running tests
  // - NODE_ENV=test: test environment
  // - CI: continuous integration builds
  // - VERCEL: Vercel build phase (before runtime env is available)
  skipValidation:
    !!process.env.VITEST ||
    process.env.NODE_ENV === 'test' ||
    !!process.env.CI ||
    (!!process.env.VERCEL && !process.env.DATABASE_URL),
})
