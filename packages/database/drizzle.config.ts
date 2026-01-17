import { env } from './src/env.js'
import { type Config } from 'drizzle-kit'

export default {
	schema: ['./src/schema.ts'],
	dialect: 'mysql',
	dbCredentials: {
		url: env.DATABASE_URL,
	},
	tablesFilter: ['SUPPORT_*'],
	out: './src/drizzle',
} satisfies Config
