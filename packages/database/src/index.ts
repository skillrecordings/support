import { drizzle } from 'drizzle-orm/mysql2'
import mysql from 'mysql2/promise'
import { env } from './env.js'
import * as schema from './schema.js'

let db: any = null

export function getDb() {
	if (!db) {
		const connection = mysql.createPool({
			uri: env.DATABASE_URL,
		})
		db = drizzle(connection, { schema, mode: 'default' })
	}
	return db
}

export const database = getDb()

// Re-export schema and types for convenience
export * from './schema.js'
export { env }
