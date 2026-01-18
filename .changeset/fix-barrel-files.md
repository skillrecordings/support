---
"@skillrecordings/core": patch
"@skillrecordings/sdk": patch
---

Remove barrel files, use subpath exports only

- Delete core/src/index.ts and sdk/src/index.ts barrel files
- Use explicit subpath imports like `@skillrecordings/sdk/client`
- Fixes Turbopack build compatibility
