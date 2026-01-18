import { type Config } from 'drizzle-kit'

export default {
	schema: ['./src/schema.ts'],
	dialect: 'mysql',
	dbCredentials: {
		url: process.env.DATABASE_URL!,
	},
	tablesFilter: ['SUPPORT_*'],
	out: './src/drizzle',
} satisfies Config
