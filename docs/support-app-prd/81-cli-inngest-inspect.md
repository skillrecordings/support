# CLI Inngest Inspection

> Debug and monitor Inngest workflows from the command line.

## Overview

Add `skill inngest` command group to inspect events, runs, and manually trigger signals for HITL debugging.

## Auth

Uses `INNGEST_SIGNING_KEY` as Bearer token. Already in CLI env.

```typescript
const headers = {
  Authorization: `Bearer ${process.env.INNGEST_SIGNING_KEY}`,
  'Content-Type': 'application/json',
}
```

## Base URLs

- Production: `https://api.inngest.com`
- Dev Server: `http://localhost:8288`

CLI should auto-detect dev server or allow `--dev` flag.

## Commands

### `skill inngest events`

List recent events.

```bash
skill inngest events                    # Last hour
skill inngest events --name "support/*" # Filter by event name
skill inngest events --after "2h"       # Last 2 hours
skill inngest events --limit 50         # Up to 100
skill inngest events --json             # Machine-readable
```

**API**: `GET /v1/events`

Query params:
- `name` - Event name filter
- `received_after` - RFC3339 timestamp
- `received_before` - RFC3339 timestamp
- `limit` - 1-100 (default varies)
- `cursor` - Pagination

**Output** (table mode):
```
ID                          NAME                      RECEIVED
01HE8AM9DPK9N37V1RKY1DNQF5  support/conversation.new  2024-01-15 10:23:45
01HE8AM9DPK9N37V1RKY1DNQF6  support/draft.approved    2024-01-15 10:24:12
```

### `skill inngest event <id>`

Get event details and runs it triggered.

```bash
skill inngest event 01HE8AM9DPK9N37V1RKY1DNQF5
skill inngest event 01HE8AM9DPK9N37V1RKY1DNQF5 --json
```

**API**:
- `GET /v1/events/{internalID}` - Event data
- `GET /v1/events/{internalID}/runs` - Triggered runs

**Output**:
```
Event: 01HE8AM9DPK9N37V1RKY1DNQF5
Name:  support/conversation.new
Time:  2024-01-15 10:23:45

Data:
  conversationId: cnv_abc123
  inboxId: inb_xyz789

Runs:
  RUN ID                          FUNCTION                    STATUS     STARTED
  01HE8AM9DPK9N37V1RKY1DNQF7      support/ingest-conversation Completed  10:23:46
  01HE8AM9DPK9N37V1RKY1DNQF8      support/classify-intent     Running    10:23:47
```

### `skill inngest run <id>`

Get function run details.

```bash
skill inngest run 01HE8AM9DPK9N37V1RKY1DNQF7
skill inngest run 01HE8AM9DPK9N37V1RKY1DNQF7 --jobs  # Show job queue position
skill inngest run 01HE8AM9DPK9N37V1RKY1DNQF7 --json
```

**API**:
- `GET /v1/runs/{runID}` - Run details
- `GET /v1/runs/{runID}/jobs` - Job queue (optional)

**Output**:
```
Run:      01HE8AM9DPK9N37V1RKY1DNQF7
Function: support/ingest-conversation
Status:   Running
Started:  2024-01-15 10:23:46
Event:    01HE8AM9DPK9N37V1RKY1DNQF5

Output: (pending)
```

### `skill inngest cancel <id>`

Cancel a running function.

```bash
skill inngest cancel 01HE8AM9DPK9N37V1RKY1DNQF7
skill inngest cancel 01HE8AM9DPK9N37V1RKY1DNQF7 --force  # Skip confirmation
```

**API**: `DELETE /v1/runs/{runID}`

### `skill inngest signal <signal>`

Resume a function waiting on `step.waitForSignal`. Critical for HITL debugging.

```bash
# Approve a draft
skill inngest signal "approval:draft_abc123" --data '{"approved": true}'

# Reject with reason
skill inngest signal "approval:draft_abc123" --data '{"approved": false, "reason": "needs revision"}'

# From file
skill inngest signal "approval:draft_abc123" --data-file ./approval.json
```

**API**: `POST /v1/signals`

```json
{
  "signal": "approval:draft_abc123",
  "data": { "approved": true }
}
```

**Output**:
```
✓ Signal sent to run 01HE8AM9DPK9N37V1RKY1DNQF7
```

### `skill inngest cancellations`

List bulk cancellations (less common, but useful for ops).

```bash
skill inngest cancellations
skill inngest cancellations --json
```

**API**: `GET /v1/cancellations`

## Implementation

### File Structure

```
packages/cli/src/commands/inngest/
├── index.ts          # Command group registration
├── client.ts         # Typed Inngest API client
├── events.ts         # events, event commands
├── runs.ts           # run, cancel commands
├── signal.ts         # signal command
└── cancellations.ts  # cancellations command (optional, lower priority)
```

### Inngest Client

```typescript
// packages/cli/src/commands/inngest/client.ts
import { z } from 'zod'

const EventSchema = z.object({
  internal_id: z.string(),
  name: z.string(),
  data: z.record(z.unknown()),
  receivedAt: z.string(),
  // ... rest from OpenAPI
})

const RunSchema = z.object({
  run_id: z.string(),
  function_id: z.string(),
  status: z.enum(['Running', 'Completed', 'Failed', 'Cancelled']),
  run_started_at: z.string(),
  ended_at: z.string().nullable(),
  output: z.unknown().nullable(),
  event_id: z.string().nullable(),
})

export class InngestClient {
  private baseUrl: string
  private signingKey: string

  constructor(opts: { dev?: boolean } = {}) {
    this.signingKey = process.env.INNGEST_SIGNING_KEY!
    this.baseUrl = opts.dev
      ? 'http://localhost:8288'
      : 'https://api.inngest.com'
  }

  private async fetch<T>(path: string, opts?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...opts,
      headers: {
        Authorization: `Bearer ${this.signingKey}`,
        'Content-Type': 'application/json',
        ...opts?.headers,
      },
    })
    if (!res.ok) {
      const error = await res.json().catch(() => ({}))
      throw new Error(error.error || `HTTP ${res.status}`)
    }
    return res.json()
  }

  async listEvents(params: ListEventsParams) { /* ... */ }
  async getEvent(id: string) { /* ... */ }
  async getEventRuns(id: string) { /* ... */ }
  async getRun(id: string) { /* ... */ }
  async cancelRun(id: string) { /* ... */ }
  async sendSignal(signal: string, data: unknown) { /* ... */ }
}
```

### Time Parsing

Support human-friendly time inputs:

```typescript
// "2h" → 2 hours ago as RFC3339
// "30m" → 30 minutes ago
// "2024-01-15" → as-is
function parseTimeArg(input: string): string {
  const match = input.match(/^(\d+)([hmd])$/)
  if (match) {
    const [, num, unit] = match
    const ms = { h: [PHONE], m: 60000, d: [PHONE] }[unit]!
    return new Date(Date.now() - parseInt(num) * ms).toISOString()
  }
  return input // Assume RFC3339
}
```

## Dev Server Detection

Check if dev server is running:

```typescript
async function detectDevServer(): Promise<boolean> {
  try {
    const res = await fetch('http://localhost:8288/v1/events?limit=1', {
      headers: { Authorization: `Bearer ${process.env.INNGEST_SIGNING_KEY}` },
      signal: AbortSignal.timeout(500),
    })
    return res.ok
  } catch {
    return false
  }
}
```

## Priority

1. **P0**: `events`, `event`, `run`, `signal` - core debugging flow
2. **P1**: `cancel` - ops necessity
3. **P2**: `cancellations` - bulk ops, less common

## Testing

- Unit tests for client with mocked responses
- Integration test against dev server (if running)
- Manual test: trigger a workflow, inspect with CLI, send signal

## Dependencies

None new - uses built-in fetch, commander (already in CLI).
