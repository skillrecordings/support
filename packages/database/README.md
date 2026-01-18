# @skillrecordings/database

Drizzle ORM database package for the Support platform. Handles schema definitions, migrations, and database client initialization.

## Setup

Database uses PlanetScale (MySQL) with the following configuration:

- **Provider**: MySQL via `mysql2`
- **ORM**: Drizzle ORM
- **Table Prefix**: `SUPPORT_` (all tables filtered by this prefix)
- **Migrations**: Generated to `src/drizzle`

## Environment

Each app (`web`, `front`, `slack`) has DATABASE_URL configured in `.env.local`:

```env
DATABASE_URL=mysql://...@aws.connect.psdb.cloud/skill-support?sslaccept=strict
```

The `@t3-oss/env-core` package validates this at runtime.

## Usage

### Import the Database Client

```typescript
import { database } from '@skillrecordings/database'
// or for lazy initialization:
import { getDb } from '@skillrecordings/database'
const db = getDb()
```

### Query the Database

```typescript
import { database, ConversationsTable } from '@skillrecordings/database'
import { eq } from 'drizzle-orm'

// Select
const conversations = await database.select().from(ConversationsTable).all()

// Filter
const conversation = await database
  .select()
  .from(ConversationsTable)
  .where(eq(ConversationsTable.external_id, 'conv_123'))
  .get()

// Insert
await database.insert(ConversationsTable).values({
  id: crypto.randomUUID(),
  external_id: 'conv_123',
  status: 'active',
})

// Update
await database
  .update(ConversationsTable)
  .set({ status: 'resolved' })
  .where(eq(ConversationsTable.id, 'id_123'))
```

## Scripts

From the root of the monorepo:

```bash
# Generate migrations from schema changes
bun run db:generate

# Apply pending migrations
bun run db:migrate

# Open Drizzle Studio (web UI for database)
bun run db:studio
```

## Schema

Currently includes:

- `SUPPORT_conversations` - Primary conversation record with Front integration
  - `id` - Primary key (UUID)
  - `external_id` - Front conversation ID (unique)
  - `status` - Enum: active, archived, resolved
  - `created_at` - Timestamp
  - `updated_at` - Timestamp with auto-update

## Adding New Tables

1. Add table definition to `src/schema.ts` with `SUPPORT_` prefix
2. Run `bun run db:generate` to create migration
3. Run `bun run db:migrate` to apply
4. Export from `src/schema.ts`

## References

- [Drizzle ORM Docs](https://orm.drizzle.team/)
- [t3-env Docs](https://env.t3.gg/)
- Pattern reference: course-builder (badass-courses/course-builder)
