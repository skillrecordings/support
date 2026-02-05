import { type MySql2Database, drizzle } from 'drizzle-orm/mysql2'
import mysql, { type Pool } from 'mysql2/promise'
import { env } from './env'
import * as schema from './schema'

export type Database = MySql2Database<typeof schema>

let db: Database | null = null
let pool: Pool | null = null

export function getDb(): Database {
  if (!db) {
    if (!env.DATABASE_URL) {
      throw new Error(
        'DATABASE_URL is not set. This command requires a database connection.\n' +
          'Set DATABASE_URL in your environment or .env.local file.'
      )
    }
    // Strip ?sslaccept=strict from PlanetScale URLs -- mysql2 doesn't recognize it
    // and SSL is already configured via the ssl option below
    const url = new URL(env.DATABASE_URL)
    url.searchParams.delete('sslaccept')

    pool = mysql.createPool({
      uri: url.toString(),
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

/**
 * Lazy database accessor — only connects on first property access.
 * This prevents CI/build failures when DATABASE_URL is not set.
 */
export const database: Database = new Proxy({} as Database, {
  get(_target, prop, receiver) {
    return Reflect.get(getDb(), prop, receiver)
  },
})

// Re-export schema and types for convenience
export * from './schema'
export { env }

// Re-export drizzle operators for queries
export { eq, and, or, desc, asc, sql, gte, lte, gt, lt } from 'drizzle-orm'
