# @skillrecordings/sdk

## 0.3.0

### Minor Changes

- 92706d4: Add Content Search API for agent product recommendations
  - Export `ContentSearchResult`, `ContentSearchRequest`, `ContentSearchResponse` types
  - Add optional `searchContent` method to `SupportIntegration` interface
  - Add `searchContent()` to `IntegrationClient` for platform-to-product calls
  - Add `searchContent` action routing in `createSupportHandler`

## 0.2.3

### Patch Changes

- 2820cb9: Remove barrel files, use subpath exports only
  - Delete core/src/index.ts and sdk/src/index.ts barrel files
  - Use explicit subpath imports like `@skillrecordings/sdk/client`
  - Fixes Turbopack build compatibility

## 0.2.2

### Patch Changes

- 77b4f94: Add typesVersions for backwards compatibility with legacy moduleResolution

  Projects using `moduleResolution: "node"` can now resolve subpath exports like `@skillrecordings/sdk/integration` without changing their tsconfig.

## 0.2.1

### Patch Changes

- c4c0fc0: Fix SDK build: compile TypeScript to JavaScript for npm consumers
  - Add tsup build step with ESM output
  - Update exports to point to compiled dist/
  - Add files field to include only dist/

## 0.2.0

### Minor Changes

- 91c7136: Initial public release of the Skill Recordings Support SDK.

  Provides the integration contract for apps to connect to the support platform:
  - `IntegrationClient` for querying user data and purchases
  - Webhook handler utilities for SDK-to-platform communication
  - Type definitions for the integration interface
