# Rule: zod-v4-import

**Priority:** CRITICAL (P0)
**Impact:** Build-breaking TypeScript error
**Error:** TS2589 "Type instantiation is excessively deep and possibly infinite"

## The Rule

When using ANY Zod schema with AI SDK v6, you MUST use the `zod/v4` import path.

```typescript
// ❌ WRONG - causes TS2589
import { z } from 'zod'

// ✅ CORRECT - use zod/v4
import { z } from 'zod/v4'
```

## Why This Happens

AI SDK v6 uses deeply recursive TypeScript generics for type inference:
- `FlexibleSchema<T>` wraps Zod schemas
- `InferSchema<SCHEMA>` extracts the inferred type
- `generateObject`, `streamObject`, `tool()` all use these generics

Zod v3's type definitions cause TypeScript to exceed its default recursion depth limit (50). Zod v4 has optimized type exports that stay within limits.

## Affected APIs

ALL schema-related AI SDK APIs:
- `generateObject({ schema: z.object({...}) })`
- `streamObject({ schema: z.object({...}) })`
- `tool({ inputSchema: z.object({...}) })`
- `Output.object({ schema: z.object({...}) })`

## How We Discovered This

The AI SDK source code (specifically their test files) uses `import { z } from 'zod/v4'`. When we examined `/tmp/ai-sdk-check/packages/ai/src/generate-object/generate-object.test-d.ts`, line 3 was:

```typescript
import { z } from 'zod/v4';
```

## Project Setup

This project has both Zod versions installed:
- `zod@3.25.76` - default import (DON'T USE with AI SDK)
- `zod@4.3.5` - available via `zod/v4` subpath (USE THIS)

## Verification

If you see TS2589, immediately check your Zod import. The fix is always:

```diff
- import { z } from 'zod'
+ import { z } from 'zod/v4'
```

## Related

- AI SDK v6 migration guide
- FlexibleSchema type in @ai-sdk/provider-utils
- TypeScript recursion limits
