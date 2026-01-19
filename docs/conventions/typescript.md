# TypeScript conventions

- Prefer `type` aliases unless an interface is required for declaration merging
- Use `satisfies` for object shape validation without widening
- Keep types close to usage; avoid global types unless shared across packages
- Favor explicit return types for exported functions

## Imports and module shape

- No `.js` extensions in TS/TSX imports
- Use package exports; no barrel files

## AI SDK + Zod

This repo uses **Zod 4.x** (4.3.5+) directly:

```typescript
// ✅ Standard Zod 4 import
import { z } from 'zod'
```

Zod 4's optimized types work well with AI SDK v6's recursive generics. No special import path needed.

## Handling Type Errors

**Don't reach for `@ts-ignore` or `@ts-expect-error` as first resort.**

When hitting complex type errors (especially TS2589 with generics):

1. **Simplify the generic chain** - Use intermediate type variables
2. **Use type assertions** - `as Type` when you know the shape
3. **Narrow the type** - Type guards and conditional checks
4. **Simplify Zod schemas** - `z.string().transform()` over `z.enum()` with many values
5. **Only then** - If truly unavoidable, use `@ts-expect-error` with a comment explaining why

```typescript
// ❌ Lazy
// @ts-ignore
const result = complexGenericCall()

// ✅ Better - explain and use proper directive
// @ts-expect-error - AI SDK v6 recursive generic exceeds TS depth limit
// See: https://github.com/vercel/ai/issues/XXX
const result = complexGenericCall()
```

## Typecheck policy

Types always pass. Do not blame pre-existing errors. Fix or revert.
