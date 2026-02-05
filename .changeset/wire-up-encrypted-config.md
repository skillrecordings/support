---
"@skillrecordings/cli": patch
---

fix: wire up .env.encrypted decryption via 1Password age key

- Implement `decryptEnvFile()` to actually decrypt shipped secrets
- Get age private key from 1Password (`op://Support/skill-cli-age-key/private_key`)
- Ship `.env.encrypted` with npm package
- Add LINEAR_API_KEY and AI_GATEWAY_API_KEY to secret refs
- Global installs now work with `OP_SERVICE_ACCOUNT_TOKEN` set
