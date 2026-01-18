#!/usr/bin/env node
import { spawnSync } from 'node:child_process'

const files = process.argv.slice(2)

// Filter to only files in apps/ or packages/ (biome's include paths)
const biomeFiles = files.filter(
  (f) => f.includes('/apps/') || f.includes('/packages/')
)

const run = (args) => {
  const result = spawnSync('biome', args, { stdio: 'inherit' })
  return result.status ?? 1
}

let exitCode = 0

if (biomeFiles.length > 0) {
  exitCode = run(['check', '--write', '--files-ignore-unknown=true', ...biomeFiles])
}

if (exitCode !== 0) {
  const message = [
    '🛑 Pre-commit blocked: Biome failed on staged files.',
    `Files: ${biomeFiles.length > 0 ? biomeFiles.join(', ') : 'none in apps/ or packages/'}`,
    '',
    'Agent instructions (do this now):',
    '- Read /.claude/skills and AGENTS.md, then fix the violation.',
    '- See docs/CONVENTIONS.md and docs/TESTING.md for repo rules.',
    '- Re-run `bunx lint-staged` after fixing.',
  ].join('\n')

  process.stderr.write(message)
  process.stderr.write('\n')
}

process.exit(exitCode)
