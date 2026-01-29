import { program } from 'commander'
import {
  ConversationsTable,
  database,
  desc,
  sql,
} from '@skillrecordings/database'

export const registerDbStatusCommand = (prog: typeof program) => {
  prog
    .command('db-status')
    .description('Check database status and conversation counts')
    .action(async () => {
      try {
        // Count by status
        const statusCounts = await database
          .select({
            status: ConversationsTable.status,
            count: sql<number>`COUNT(*)`.as('count'),
          })
          .from(ConversationsTable)
          .groupBy(ConversationsTable.status)

        console.log('Conversation counts by status:')
        for (const row of statusCounts) {
          console.log(`  ${row.status}: ${row.count}`)
        }

        // Get recent conversations
        const recent = await database
          .select()
          .from(ConversationsTable)
          .orderBy(desc(ConversationsTable.updated_at))
          .limit(5)

        console.log('\nRecent conversations:')
        for (const c of recent) {
          console.log(`  ${c.front_conversation_id}: ${c.status} (${c.updated_at})`)
        }

        process.exit(0)
      } catch (error) {
        console.error('Error:', error)
        process.exit(1)
      }
    })
}
