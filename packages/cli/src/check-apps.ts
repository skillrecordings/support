import '../preload'
import { database, AppsTable } from '@skillrecordings/database'

async function main() {
  const apps = await database.select().from(AppsTable)
  console.log('\n📦 Registered Apps:\n')
  for (const app of apps) {
    console.log(`  ${app.slug} (${app.name})`)
    console.log(`    Instructor: ${app.instructor_teammate_id || '❌ NOT SET'}`)
    console.log(`    Front Inbox: ${app.front_inbox_id}`)
    console.log(`    Capabilities: ${JSON.stringify(app.capabilities)}`)
    console.log()
  }
  process.exit(0)
}
main()
