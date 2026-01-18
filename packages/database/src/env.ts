import { createEnv } from '@t3-oss/env-core'
import { z } from 'zod'

export const env = createEnv({
	server: {
		DATABASE_URL: z.string().url(),
	},
	runtimeEnv: process.env,
	// Skip validation in test environment - tests mock the database
	skipValidation: !!process.env.VITEST || process.env.NODE_ENV === 'test',
})
