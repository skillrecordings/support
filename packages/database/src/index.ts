import { drizzle } from 'drizzle-orm/mysql2'
import mysql from 'mysql2/promise'
import { env } from './env'
import * as schema from './schema'

let db: any = null

export function getDb() {
	if (!db) {
		const connection = mysql.createPool({
			uri: env.DATABASE_URL,
			ssl: {
				rejectUnauthorized: true,
			},
		})
		db = drizzle(connection, { schema, mode: 'default' })
	}
	return db
}

export const database = getDb()

// Re-export schema and types for convenience
export * from './schema'
export { env }

// Re-export drizzle operators for queries
export { eq, and, or, desc, asc, sql } from 'drizzle-orm'
