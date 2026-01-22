---
"@skillrecordings/sdk": minor
---

Add product availability/inventory checking to SDK

- Add `ProductStatus` interface with availability, seat counts, product type, state, and date fields
- Add `ProductType` and `ProductState` types
- Add Zod schemas (`ProductStatusSchema`, `ProductTypeSchema`, `ProductStateSchema`) for runtime validation
- Add optional `getProductStatus(productId: string)` method to `SupportIntegration` interface
- Add routing in handler for `getProductStatus` action (returns 501 if not implemented)
- Add `getProductStatus` method to `IntegrationClient`

Apps can implement `getProductStatus` to allow the support agent to check product availability before making claims about sold-out status or seat availability.
