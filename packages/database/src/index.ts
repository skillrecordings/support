import { type MySql2Database, drizzle } from 'drizzle-orm/mysql2'
import mysql, { type Pool } from 'mysql2/promise'
import { env } from './env'
import * as schema from './schema'

export type Database = MySql2Database<typeof schema>

let db: Database | null = null
let pool: Pool | null = null

export function getDb(): Database {
  if (!db) {
    pool = mysql.createPool({
      uri: env.DATABASE_URL,
      ssl: {
        rejectUnauthorized: true,
      },
    })
    db = drizzle(pool, { schema, mode: 'default' })
  }
  return db
}

/**
 * Close the database connection pool.
 * Call this before process exit in CLI commands to prevent hanging.
 */
export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end()
    pool = null
    db = null
  }
}

export const database = getDb()

// Re-export schema and types for convenience
export * from './schema'
export { env }

// Re-export drizzle operators for queries
export { eq, and, or, desc, asc, sql } from 'drizzle-orm'
