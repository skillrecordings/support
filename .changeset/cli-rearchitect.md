---
"@skillrecordings/cli": minor
---

CLI rearchitect: agent-first compiled binary rewrite

- CommandContext unified context object replacing scattered globals
- SecretsProvider abstraction (1Password SDK + env fallback)
- OutputFormatter with JSON/text/table output and auto-detection
- MCP server mode (JSON-RPC stdio, 9 Front tools for Claude Code)
- Compiled binary build with embedded metadata
- Interactive auth wizard with 1Password deep links
- Front API response caching (3-tier TTL + mutation invalidation)
- Proactive rate limiter (token bucket, 100 req/min)
- CSV injection sanitization in output formatting
- New commands: assign, tag, reply, search, api passthrough
- HATEOAS JSON responses with _links and _actions
- 178 tests passing
