# Conventions

## Repo structure
- `apps/*`: deployable surfaces
- `packages/*`: shared libraries and core logic
- `docs/*`: product + engineering docs

## Naming
- Packages use `@skillrecordings/*`
- Env vars use `UPPER_SNAKE_CASE` with service prefixes

## Testing
- TDD required: red → green → refactor
- Prefer targeted tests over repo-wide
- Add tests alongside the change that requires them

## Tooling
- Prefer official CLIs for config/scaffolding
- Avoid manual boilerplate unless CLI fails

## Database

- **Lazy initialization in serverless**: Use `getDb()` not `database` singleton in Inngest workflows. The singleton creates a MySQL pool at import time which fails in serverless build.
- **Drizzle operators**: Import `eq`, `and`, `desc` etc. from `@skillrecordings/database`, not directly from `drizzle-orm`. Avoids version mismatch issues.
- **Test environment**: `skipValidation` is enabled for t3-env when `VITEST` or `NODE_ENV=test`. Tests don't need real DATABASE_URL.

## Imports

- **No .js extensions**: Turbopack doesn't resolve `./foo.js` to `foo.ts`. Use extensionless imports.
- **Package exports over barrels**: See AGENTS.md for the mandate.

## Do / Don't
- Do keep workflows in Inngest
- Do keep Front as conversation source of truth
- Do use `getDb()` in workflow steps, not `database` singleton
- Don't add alternative workflow engines
- Don't bypass approval gates for risky actions
- Don't import drizzle-orm directly in packages that consume @skillrecordings/database
