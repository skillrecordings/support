---
"@skillrecordings/cli": minor
---

feat: user-local API key config with write gating

- Add user config directory at `~/.config/skill` (XDG-compliant)
- Store user secrets in `.env.user.encrypted` using age encryption
- Track key provenance ('user' vs 'shipped') for write gating
- Gate all Linear write operations on personal API keys:
  - create, update, assign, state, close, label, link, comment
- Add `skill config` commands: init, set, get, list
- Include HATEOAS hints in JSON output:
  - `_meta.personal_key_hint` with setup instructions
  - `_actions[].requires_personal_key` flag for write actions
