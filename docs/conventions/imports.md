# Imports

- **No .js extensions**: Turbopack doesn't resolve `./foo.js` to `foo.ts`. Use extensionless imports.
- **Package exports over barrels**: Barrel files are not allowed. Use package.json exports.

## No barrel files (package exports only)

Barrel files are `index.ts` re-export aggregations. They are **not allowed**.

```typescript
// BAD - barrel file
export * from './foo'
export * from './bar'
export { thing } from './baz'
```

Use package exports instead:

```json
{
  "name": "@skillrecordings/core",
  "exports": {
    "./agent": "./src/agent/config.ts",
    "./tools": "./src/tools/create-tool.ts",
    "./tools/*": "./src/tools/*.ts"
  }
}
```

```typescript
// GOOD - direct import via package exports
import { supportAgent } from '@skillrecordings/core/agent'
```
