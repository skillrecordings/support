import { type Config } from 'drizzle-kit'

// Parse DATABASE_URL for drizzle-kit (needs explicit SSL config for PlanetScale)
const url = new URL(process.env.DATABASE_URL!.replace('mysql://', 'http://'))

export default {
	schema: ['./src/schema.ts'],
	dialect: 'mysql',
	dbCredentials: {
		host: url.hostname,
		port: url.port ? parseInt(url.port) : 3306,
		user: url.username,
		password: url.password,
		database: url.pathname.slice(1), // remove leading /
		ssl: {
			rejectUnauthorized: true,
		},
	},
	tablesFilter: ['SUPPORT_*'],
	out: './src/drizzle',
} satisfies Config
