import { beforeAll } from 'vitest'

beforeAll(() => {
	// Set required environment variables for tests
	process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test'
})
