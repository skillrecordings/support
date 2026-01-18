#!/usr/bin/env node
import { spawnSync } from 'node:child_process'

const result = spawnSync('bun', ['run', 'check-types'], { stdio: 'inherit' })
const exitCode = result.status ?? 1

if (exitCode !== 0) {
  const message = [
    '🛑 Pre-commit blocked: typecheck failed.',
    'Rule: types always pass. Do NOT blame pre-existing errors.',
    'Agent instructions:',
    '- Fix the type errors in this change or revert the change.',
    '- Read /.claude/skills and AGENTS.md before retrying.',
  ].join('\n')

  process.stderr.write(message)
  process.stderr.write('\n')
}

process.exit(exitCode)
