---
"@skillrecordings/cli": patch
---

Wire up secret loading (1Password/age encryption) in bundled CLI

- Bundle preload.ts as separate entry point for secret loading
- Fix path resolution for bundled dist/ directory
- Accept cliDir parameter in loadSecrets for correct .env discovery
- Help/auth commands gracefully degrade without secrets
