# Database

- **Lazy initialization in serverless**: Use `getDb()` not `database` singleton in Inngest workflows. The singleton creates a MySQL pool at import time which fails in serverless build.
- **Drizzle operators**: Import `eq`, `and`, `desc` etc. from `@skillrecordings/database`, not directly from `drizzle-orm`. Avoids version mismatch issues.
- **Test environment**: `skipValidation` is enabled for t3-env when `VITEST` or `NODE_ENV=test`. Tests don't need real DATABASE_URL.
