---
"@skillrecordings/cli": minor
---

Bundle workspace dependencies for npm publishing

- Add tsup config to bundle @skillrecordings/* packages
- Create bin/skill.mjs wrapper for global install
- Requires bun runtime (#!/usr/bin/env bun)
- Install globally: `bun i -g @skillrecordings/cli`
