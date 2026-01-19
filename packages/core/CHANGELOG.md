# @skillrecordings/core

## 0.0.1

### Patch Changes

- 2820cb9: Remove barrel files, use subpath exports only
  - Delete core/src/index.ts and sdk/src/index.ts barrel files
  - Use explicit subpath imports like `@skillrecordings/sdk/client`
  - Fixes Turbopack build compatibility

- Updated dependencies [2820cb9]
  - @skillrecordings/sdk@0.2.3
