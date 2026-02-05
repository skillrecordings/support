---
"@skillrecordings/cli": minor
---

Add comprehensive Linear integration for issue tracking

**New Commands:**
- `skill linear issues` - List issues with filters (team/state/assignee/project/priority)
- `skill linear my` - List your assigned issues
- `skill linear search <query>` - Full-text search
- `skill linear issue <id>` - View issue details
- `skill linear create <title>` - Create issue with labels/assignee/priority
- `skill linear update <id>` - Update issue properties
- `skill linear assign <id>` - Assign/unassign issues
- `skill linear state <id>` - Change workflow state
- `skill linear close <id>` - Close as done or canceled
- `skill linear label <id>` - Add/remove labels
- `skill linear link <id>` - Create issue relations (blocks/related/duplicate)
- `skill linear comment <id>` - Add markdown comment
- `skill linear comments <id>` - List comment history
- `skill linear teams` - List workspace teams
- `skill linear states <team>` - List workflow states
- `skill linear labels <team>` - List available labels
- `skill linear users` - List workspace users
- `skill linear projects` - List projects

**Features:**
- HATEOAS support: JSON output includes `_links` and `_actions` for agent discoverability
- Excellent help text with usage examples for every command
- Full filtering support (team, state, assignee, project, priority)
- Markdown support in comments and descriptions
