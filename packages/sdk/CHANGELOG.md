# @skillrecordings/sdk

## 0.6.0

### Minor Changes

- 7ae3e99: Add optional SDK methods for agent intelligence:
  - getActivePromotions / getCouponInfo — promotion and coupon lookup
  - getRefundPolicy — dynamic per-app refund policy
  - getContentAccess — granular content access checking
  - getRecentActivity — user activity and progress tracking
  - getLicenseInfo — team license and seat management
  - getAppInfo — app metadata (URLs, instructor, support email)

  All methods are optional — existing integrations are unaffected.

  New Zod schemas: PromotionSchema, CouponInfoSchema, RefundPolicySchema,
  ContentAccessSchema, UserActivitySchema, LicenseInfoSchema, AppInfoSchema.

  Client handles 501 (Not Implemented) gracefully for optional methods,
  returning null or empty arrays instead of throwing.

## 0.5.0

### Minor Changes

- 36efccf: Add optional SDK methods for agent intelligence:
  - getActivePromotions / getCouponInfo — promotion and coupon lookup
  - getRefundPolicy — dynamic per-app refund policy
  - getContentAccess — granular content access checking
  - getRecentActivity — user activity and progress tracking
  - getLicenseInfo — team license and seat management
  - getAppInfo — app metadata (URLs, instructor, support email)

  All methods are optional — existing integrations are unaffected.

  New Zod schemas: PromotionSchema, CouponInfoSchema, RefundPolicySchema,
  ContentAccessSchema, UserActivitySchema, LicenseInfoSchema, AppInfoSchema.

  Client handles 501 (Not Implemented) gracefully for optional methods,
  returning null or empty arrays instead of throwing.

## 0.4.0

### Minor Changes

- 7c5c5d8: Add product availability/inventory checking to SDK
  - Add `ProductStatus` interface with availability, seat counts, product type, state, and date fields
  - Add `ProductType` and `ProductState` types
  - Add Zod schemas (`ProductStatusSchema`, `ProductTypeSchema`, `ProductStateSchema`) for runtime validation
  - Add optional `getProductStatus(productId: string)` method to `SupportIntegration` interface
  - Add routing in handler for `getProductStatus` action (returns 501 if not implemented)
  - Add `getProductStatus` method to `IntegrationClient`

  Apps can implement `getProductStatus` to allow the support agent to check product availability before making claims about sold-out status or seat availability.

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
