# Dev Commands

## Root commands
```bash
bun run dev
bun run test
bun run lint
bun run check-types
bun run format
bun run format:check
```

## Targeted commands (turborepo)
```bash
bun run dev --filter=web
bun run test --filter=web
bun run lint --filter=packages/core
bun run check-types --filter=apps/front
```

## Database
```bash
bun run db:generate
bun run db:migrate
bun run db:studio
```

## Ports
- `apps/web`: 4100
- `apps/front`: 4101
- `apps/slack`: 4102
