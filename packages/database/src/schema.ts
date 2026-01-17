import { datetime, mysqlTable, varchar } from 'drizzle-orm/mysql-core'
import { sql } from 'drizzle-orm'

export const ConversationsTable = mysqlTable('SUPPORT_conversations', {
	id: varchar('id', { length: 255 }).primaryKey(),
	external_id: varchar('external_id', { length: 255 }).notNull().unique(),
	status: varchar('status', {
		length: 50,
		enum: ['active', 'archived', 'resolved'],
	})
		.notNull()
		.default('active'),
	created_at: datetime('created_at').default(sql`CURRENT_TIMESTAMP`),
	updated_at: datetime('updated_at')
		.default(sql`CURRENT_TIMESTAMP`)
		.$onUpdateFn(() => new Date()),
})
