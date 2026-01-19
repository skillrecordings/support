---
"@skillrecordings/sdk": minor
---

Add Content Search API for agent product recommendations

- Export `ContentSearchResult`, `ContentSearchRequest`, `ContentSearchResponse` types
- Add optional `searchContent` method to `SupportIntegration` interface
- Add `searchContent()` to `IntegrationClient` for platform-to-product calls
- Add `searchContent` action routing in `createSupportHandler`
