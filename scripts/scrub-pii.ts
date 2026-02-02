#!/usr/bin/env bun
import fs from 'node:fs/promises'
import path from 'node:path'

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g
const PHONE_REGEX = /(?:\+?\d{1,2}[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}/g
const ADDRESS_REGEX = /\b\d{1,5}\s+[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,3}\s+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Way|Wy|Place|Pl|Terrace|Ter|Circle|Cir|Parkway|Pkwy)\b\.?/gi

const NAME_PATTERNS: RegExp[] = [
  /(?:^|[\n\r])\s*(?:Hi|Hello|Hey)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\s*[,!\n\r]/g,
  /(?:Thanks|Thank you|Best|Cheers|Sincerely|Regards)\s*,?\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\b/g,
]

type Counts = {
  email: number
  phone: number
  address: number
  name: number
}

type ScrubResult = {
  text: string
  counts: Counts
}

const ZERO_COUNTS: Counts = { email: 0, phone: 0, address: 0, name: 0 }

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function collectNames(text: string): string[] {
  const names = new Set<string>()
  for (const pattern of NAME_PATTERNS) {
    let match: RegExpExecArray | null
    while ((match = pattern.exec(text)) !== null) {
      if (match[1]) {
        names.add(match[1].trim())
      }
    }
  }
  return Array.from(names)
}

function scrubText(text: string): ScrubResult {
  const counts: Counts = { ...ZERO_COUNTS }
  const names = collectNames(text)

  let output = text.replace(EMAIL_REGEX, () => {
    counts.email += 1
    return '[EMAIL]'
  })

  output = output.replace(PHONE_REGEX, () => {
    counts.phone += 1
    return '[PHONE]'
  })

  output = output.replace(ADDRESS_REGEX, () => {
    counts.address += 1
    return '[ADDRESS]'
  })

  if (names.length > 0) {
    for (const name of names) {
      const nameRegex = new RegExp(`\\b${escapeRegExp(name)}\\b`, 'g')
      output = output.replace(nameRegex, () => {
        counts.name += 1
        return '[NAME]'
      })
    }
  }

  return { text: output, counts }
}

async function listFiles(inputPaths: string[]): Promise<string[]> {
  const results: string[] = []

  async function walk(currentPath: string) {
    const stats = await fs.stat(currentPath)
    if (stats.isFile()) {
      const ext = path.extname(currentPath).toLowerCase()
      if (ext === '.md' || ext === '.json') {
        results.push(currentPath)
      }
      return
    }

    if (!stats.isDirectory()) return

    const entries = await fs.readdir(currentPath, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue
      }
      await walk(path.join(currentPath, entry.name))
    }
  }

  for (const inputPath of inputPaths) {
    await walk(inputPath)
  }

  return results
}

function formatCounts(counts: Counts): string {
  const total = counts.email + counts.phone + counts.address + counts.name
  return `EMAIL=${counts.email} NAME=${counts.name} PHONE=${counts.phone} ADDRESS=${counts.address} total=${total}`
}

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const paths = args.filter(arg => arg !== '--dry-run')

  const targets = paths.length > 0 ? paths : [process.cwd()]
  const files = await listFiles(targets)

  if (files.length === 0) {
    console.log('No .md or .json files found.')
    return
  }

  let totalCounts: Counts = { ...ZERO_COUNTS }

  for (const filePath of files) {
    const original = await fs.readFile(filePath, 'utf8')
    const { text, counts } = scrubText(original)

    totalCounts = {
      email: totalCounts.email + counts.email,
      phone: totalCounts.phone + counts.phone,
      address: totalCounts.address + counts.address,
      name: totalCounts.name + counts.name,
    }

    if (!dryRun && text !== original) {
      await fs.writeFile(filePath, text, 'utf8')
    }

    if (counts.email + counts.phone + counts.address + counts.name > 0) {
      const modeLabel = dryRun ? 'dry-run' : 'scrubbed'
      console.log(`${modeLabel}: ${filePath} -> ${formatCounts(counts)}`)
    }
  }

  const summaryLabel = dryRun ? 'dry-run summary' : 'summary'
  console.log(`${summaryLabel}: ${formatCounts(totalCounts)}`)
}

main().catch(error => {
  console.error('Failed to scrub PII:', error)
  process.exit(1)
})
