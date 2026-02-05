# Example: Bulk Archive with Dry Run

Goal: preview handled-tag conversations before archiving.

Dry run:
```bash
skill front bulk-archive -i inb_3srbb --filter "tag:handled" --dry-run --json
```

Review the preview output with the user.
Only proceed after explicit approval.

Execute after approval:
```bash
skill front bulk-archive -i inb_3srbb --filter "tag:handled" --json
```
