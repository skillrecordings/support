---
"@skillrecordings/sdk": patch
---

Fix SDK build: compile TypeScript to JavaScript for npm consumers

- Add tsup build step with ESM output
- Update exports to point to compiled dist/
- Add files field to include only dist/
