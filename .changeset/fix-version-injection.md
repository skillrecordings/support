---
"@skillrecordings/cli": patch
---

fix: inject BUILD_VERSION in tsup build for npm package

The tsup build (used for npm publishing) now injects BUILD_VERSION, BUILD_COMMIT, and BUILD_TARGET at build time. Previously only the native binary build did this, causing npm-installed CLI to show "0.0.0-dev".
