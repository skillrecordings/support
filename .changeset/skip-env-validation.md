---
"@skillrecordings/cli": patch
---

Skip env validation at import time to allow CLI to run without DATABASE_URL

Commands that don't need the database (help, auth, etc.) now work without env vars configured. Commands that need the database will fail at runtime with a clear error when they try to use it.
