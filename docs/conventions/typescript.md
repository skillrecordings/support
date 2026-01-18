# TypeScript conventions

- Prefer `type` aliases unless an interface is required for declaration merging
- Use `satisfies` for object shape validation without widening
- Keep types close to usage; avoid global types unless shared across packages
- Favor explicit return types for exported functions

## Imports and module shape

- No `.js` extensions in TS/TSX imports
- Use package exports; no barrel files

## AI SDK + Zod (CRITICAL)

```typescript
// ❌ WRONG - causes TS2589 "Type instantiation is excessively deep"
import { z } from 'zod'

// ✅ CORRECT - always use zod/v4 with AI SDK v6
import { z } from 'zod/v4'
```

This applies to ALL AI SDK schema usage: `generateObject`, `streamObject`, `tool()`, `Output.object()`.

## Typecheck policy

Types always pass. Do not blame pre-existing errors. Fix or revert.
