---
"@skillrecordings/sdk": patch
---

Add typesVersions for backwards compatibility with legacy moduleResolution

Projects using `moduleResolution: "node"` can now resolve subpath exports like `@skillrecordings/sdk/integration` without changing their tsconfig.
