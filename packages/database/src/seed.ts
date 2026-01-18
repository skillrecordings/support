import { AppsTable, database } from './index'

/**
 * Seed the database with initial app records.
 * Run with: pnpm --filter @skillrecordings/database seed
 */
async function seed() {
  console.log('Seeding database...')

  // Total TypeScript - stub for initial setup
  await database
    .insert(AppsTable)
    .values({
      id: 'app_totaltypescript',
      slug: 'total-typescript',
      name: 'Total TypeScript',
      front_inbox_id: 'inb_3srbb',
      integration_base_url: 'https://www.totaltypescript.com/api/support',
      webhook_secret: `whsec_${crypto.randomUUID().replace(/-/g, '')}`,
      capabilities: ['refund', 'lookup_user', 'get_purchases', 'revoke_access'],
    })
    .onDuplicateKeyUpdate({
      set: {
        name: 'Total TypeScript', // no-op update for upsert behavior
      },
    })

  console.log('✓ Seeded Total TypeScript app')

  process.exit(0)
}

seed().catch((err) => {
  console.error('Seed failed:', err)
  process.exit(1)
})
