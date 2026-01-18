#!/usr/bin/env node
import { execSync } from 'node:child_process'

const encoder = new TextEncoder()

const getStagedIndexTsFiles = () => {
  const out = execSync('git diff --cached --name-only --diff-filter=ACMR', {
    encoding: 'utf8',
  }).trim()

  if (!out) return []
  return out.split('\n').filter((file) => file.endsWith('/index.ts') || file === 'index.ts')
}

const getStagedFile = (file) => {
  try {
    return execSync(`git show :"${file}"`, { encoding: 'utf8' })
  } catch {
    return null
  }
}

const stripInlineComment = (line) => line.replace(/\/\/.*$/, '').trim()

const isBarrel = (source) => {
  const lines = source.split(/\r?\n/)
  let meaningfulCount = 0
  let exportFromCount = 0
  let nonExportStatement = false
  let pendingExportFrom = false

  for (const rawLine of lines) {
    const cleaned = stripInlineComment(rawLine)
    const line = cleaned.trim()
    if (!line) continue
    if (line.startsWith('/*') || line.startsWith('*') || line.startsWith('*/')) continue

    meaningfulCount += 1

    if (pendingExportFrom) {
      if (line.includes(' from ') || line.startsWith('from ')) {
        exportFromCount += 1
        pendingExportFrom = false
      }
      continue
    }

    if (/^export\s+\*\s+from\s+/.test(line)) {
      exportFromCount += 1
      continue
    }

    if (/^export\s+type\s*\{/.test(line) || /^export\s*\{/.test(line)) {
      if (line.includes(' from ')) {
        exportFromCount += 1
      } else {
        pendingExportFrom = true
      }
      continue
    }

    if (line.startsWith('export ')) {
      if (line.includes(' from ')) {
        exportFromCount += 1
      } else {
        nonExportStatement = true
      }
      continue
    }

    nonExportStatement = true
  }

  if (pendingExportFrom) nonExportStatement = true
  if (meaningfulCount === 0) return false
  return exportFromCount > 0 && !nonExportStatement
}

const files = getStagedIndexTsFiles()
const offenders = []

for (const file of files) {
  const staged = getStagedFile(file)
  if (!staged) continue
  if (isBarrel(staged)) offenders.push(file)
}

if (offenders.length > 0) {
  const message = [
    'Pre-commit blocked: new/modified barrel files are not allowed.',
    'Use package.json exports instead of index.ts re-exports.',
    '',
    'Agent instructions:',
    '- Read /.claude/skills and AGENTS.md, then fix the violation.',
    '- See docs/CONVENTIONS.md and docs/TESTING.md for repo rules.',
    '- Replace barrel exports with package.json exports and direct imports.',
    '',
    `Offending files:\n${offenders.map((file) => `- ${file}`).join('\n')}`,
  ].join('\n')

  process.stderr.write(message)
  process.stderr.write('\n')
  process.exit(1)
}
