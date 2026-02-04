---
"@skillrecordings/cli": minor
---
feat: wire up front commands, HATEOAS JSON output, restore .env.encrypted decryption

- Register 5 orphaned front commands (inbox, archive, bulk-archive, report, triage)
- Wrap all --json output with _links and _actions for agent discoverability
- Restore age decryption for .env.encrypted (AGE_SECRET_KEY from shell env)
- Update command descriptions for clarity
