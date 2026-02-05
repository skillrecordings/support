---
"@skillrecordings/cli": patch
---

fix(cli): remove misleading prerequisite text from help

Keys ship encrypted with the CLI, so telling users they need to set
FRONT_API_TOKEN or INNGEST keys is confusing. Updated all adaptive
help descriptions to reflect reality.
