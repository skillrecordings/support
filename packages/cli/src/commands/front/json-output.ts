/**
 * JSON output utility for Front CLI commands.
 *
 * Large JSON payloads (>64KB) are written to a temp file to avoid
 * stdout buffer truncation. A small summary envelope is printed to
 * stdout with the file path so agents/scripts can find the data.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const STDOUT_LIMIT = 64 * 1024 // 64KB — safe for pipe buffers

/**
 * Write JSON to stdout or temp file depending on size.
 *
 * Small payloads go straight to stdout.
 * Large payloads are written to /tmp/skill-front/<timestamp>.json
 * and a summary envelope is printed to stdout.
 */
export function writeJsonOutput(data: unknown): void {
  const json = JSON.stringify(data, null, 2)

  if (json.length <= STDOUT_LIMIT) {
    console.log(json)
    return
  }

  // Spill to temp file
  const dir = join(tmpdir(), 'skill-front')
  mkdirSync(dir, { recursive: true })
  const filepath = join(dir, `${Date.now()}.json`)
  writeFileSync(filepath, json)

  // Print summary envelope to stdout
  const envelope: Record<string, unknown> = {
    _type: (data as Record<string, unknown>)?._type ?? 'result',
    _file: filepath,
    _size: `${(json.length / 1024).toFixed(1)}KB`,
    _hint: `cat ${filepath} | jq`,
  }

  // Extract useful summary fields from HATEOAS envelope
  const d = data as Record<string, unknown>
  if (d.data && typeof d.data === 'object') {
    const inner = d.data as Record<string, unknown>
    if (inner.total !== undefined) envelope.total = inner.total
    if (inner.query !== undefined) envelope.query = inner.query

    // Include conversation summaries (id + subject only)
    if (Array.isArray(inner.conversations)) {
      envelope.conversations = inner.conversations.map(
        (c: Record<string, unknown>) => ({
          id: c.id,
          subject: c.subject,
          status: c.status,
        })
      )
    }
  }

  // Include links/actions for agent discoverability
  if (Array.isArray(d._actions) && d._actions.length > 0) {
    envelope._actions = d._actions
  }

  console.log(JSON.stringify(envelope, null, 2))
}
