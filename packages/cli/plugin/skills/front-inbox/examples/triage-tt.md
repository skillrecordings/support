# Example: Triage Total TypeScript

Goal: fetch pending conversations for Total TypeScript and summarize urgency.

Command:
```bash
skill front triage -i inb_3srbb --json
```

Expected flow:
- Parse JSON response.
- Note pending count and urgent tags.
- Ask the user what to focus on next.

Follow-up question:
What should I focus on in the TT inbox?
