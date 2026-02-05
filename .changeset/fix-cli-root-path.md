---
"@skillrecordings/cli": patch
---

fix: correct cliRoot path resolution for env loading

Fixed path resolution bug where `../..` was used instead of `..` to resolve the CLI package root from `src/index.ts`. This caused `.env.local` to not be found, breaking all commands that need credentials.
