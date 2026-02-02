#!/usr/bin/env bun
import fs from 'node:fs/promises'
import path from 'node:path'

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g
const EMAIL_ENCODED_REGEX = /[a-zA-Z0-9._%+-]+%40[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi
const UUID_REGEX =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi
const LONG_HEX_REGEX = /\b[0-9a-f]{32,}\b/gi
const URL_REGEX = /https?:\/\/[^\s<>"'`]+/gi

const SENSITIVE_PARAM_KEYS = new Set([
  'token',
  'access_token',
  'client_id',
  'email',
  'purchaseid',
  'purchase_id',
  'transactionid',
  'transaction_id',
  'orderid',
])

type Counts = {
  urls: number
  tokens: number
  emails: number
  clientIds: number
  purchaseIds: number
  authLinks: number
}

const ZERO_COUNTS: Counts = {
  urls: 0,
  tokens: 0,
  emails: 0,
  clientIds: 0,
  purchaseIds: 0,
  authLinks: 0,
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function hasTokenLike(value: string): boolean {
  return UUID_REGEX.test(value) || LONG_HEX_REGEX.test(value)
}

function scrubValue(value: string, counts: Counts): string {
  let output = value

  if (EMAIL_REGEX.test(output) || EMAIL_ENCODED_REGEX.test(output)) {
    counts.emails += 1
    output = output.replace(EMAIL_REGEX, '[EMAIL]').replace(EMAIL_ENCODED_REGEX, '[EMAIL]')
  }

  if (hasTokenLike(output)) {
    counts.tokens += 1
    output = output.replace(UUID_REGEX, '[TOKEN]').replace(LONG_HEX_REGEX, '[TOKEN]')
  }

  if (/email%3d/i.test(output) || /email=/i.test(output)) {
    counts.emails += 1
    output = output.replace(/email%3d[^&\s#]+/gi, 'email%3D[EMAIL]').replace(
      /email=[^&\s#]+/gi,
      'email=[EMAIL]',
    )
  }

  return output
}

function scrubUrl(rawUrl: string, counts: Counts): string {
  let suffix = ''
  let urlText = rawUrl
  while (/[),.\]]$/.test(urlText)) {
    suffix = urlText.slice(-1) + suffix
    urlText = urlText.slice(0, -1)
  }

  const decoded = safeDecode(urlText)
  const hasAuthCallback =
    /\/auth\/callback/i.test(decoded) || /\/oauth\/callback/i.test(decoded)

  try {
    const url = new URL(urlText)
    const searchParams = new URLSearchParams(url.search)
    let touched = false

    for (const [key, value] of searchParams.entries()) {
      const normalizedKey = key.toLowerCase()
      const decodedValue = safeDecode(value)
      let nextValue = value

      if (SENSITIVE_PARAM_KEYS.has(normalizedKey) || /email/.test(normalizedKey)) {
        touched = true
        if (normalizedKey === 'client_id') {
          counts.clientIds += 1
          nextValue = '[CLIENT_ID]'
        } else if (normalizedKey.startsWith('purchase') || normalizedKey.includes('transaction') || normalizedKey.includes('order')) {
          counts.purchaseIds += 1
          nextValue = '[PURCHASE_ID]'
        } else if (normalizedKey.includes('email')) {
          counts.emails += 1
          nextValue = '[EMAIL]'
        } else {
          counts.tokens += 1
          nextValue = '[TOKEN]'
        }
      } else {
        const scrubbedValue = scrubValue(decodedValue, counts)
        if (scrubbedValue !== decodedValue) {
          touched = true
          nextValue = scrubbedValue
        }
      }

      if (nextValue !== value) {
        searchParams.set(key, nextValue)
      }
    }

    let pathname = url.pathname
    let hash = url.hash

    if (hasTokenLike(pathname) || EMAIL_ENCODED_REGEX.test(pathname) || EMAIL_REGEX.test(pathname)) {
      pathname = scrubValue(pathname, counts)
      touched = true
    }

    if (hash) {
      const scrubbedHash = scrubValue(hash, counts)
      if (scrubbedHash !== hash) {
        hash = scrubbedHash
        touched = true
      }
    }

    const reconstructed = `${url.protocol}//${url.host}${pathname}${searchParams.toString() ? `?${searchParams.toString()}` : ''}${hash}`

    if (hasAuthCallback && (hasTokenLike(decoded) || /token=|access_token=|email=|email%3d/i.test(decoded))) {
      counts.authLinks += 1
      return `[AUTH_LINK]${suffix}`
    }

    if (touched) {
      counts.urls += 1
      return `${reconstructed}${suffix}`
    }
  } catch {
    // fall through to regex-based scrub
  }

  let output = urlText
  const original = output

  output = output
    .replace(/(token=)[^&\s#]+/gi, '$1[TOKEN]')
    .replace(/(access_token=)[^&\s#]+/gi, '$1[TOKEN]')
    .replace(/(client_id=)[^&\s#]+/gi, '$1[CLIENT_ID]')
    .replace(/(purchaseId=)[^&\s#]+/gi, '$1[PURCHASE_ID]')
    .replace(/(purchase_id=)[^&\s#]+/gi, '$1[PURCHASE_ID]')
    .replace(/(transactionId=)[^&\s#]+/gi, '$1[PURCHASE_ID]')
    .replace(/(orderId=)[^&\s#]+/gi, '$1[PURCHASE_ID]')
    .replace(/(email=)[^&\s#]+/gi, '$1[EMAIL]')
    .replace(/(email%3D)[^&\s#]+/gi, '$1[EMAIL]')

  output = scrubValue(output, counts)

  if (hasAuthCallback && (hasTokenLike(output) || /token=|access_token=|email=|email%3d/i.test(output))) {
    counts.authLinks += 1
    return `[AUTH_LINK]${suffix}`
  }

  if (output !== original) {
    counts.urls += 1
  }

  return `${output}${suffix}`
}

async function listFiles(rootPath: string): Promise<string[]> {
  const results: string[] = []

  async function walk(currentPath: string) {
    const stats = await fs.stat(currentPath)
    if (stats.isFile()) {
      results.push(currentPath)
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

  await walk(rootPath)
  return results
}

function looksBinary(buffer: Buffer): boolean {
  return buffer.includes(0)
}

function formatCounts(counts: Counts): string {
  return `urls=${counts.urls} tokens=${counts.tokens} emails=${counts.emails} client_ids=${counts.clientIds} purchase_ids=${counts.purchaseIds} auth_links=${counts.authLinks}`
}

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const root = args.find(arg => arg !== '--dry-run') ?? path.join(process.cwd(), 'skills')

  const files = await listFiles(root)
  if (files.length === 0) {
    console.log(`No files found under ${root}`)
    return
  }

  let totalCounts: Counts = { ...ZERO_COUNTS }

  for (const filePath of files) {
    const buffer = await fs.readFile(filePath)
    if (looksBinary(buffer)) continue

    const original = buffer.toString('utf8')
    let text = original
    const counts: Counts = { ...ZERO_COUNTS }

    text = text.replace(URL_REGEX, match => scrubUrl(match, counts))

    totalCounts = {
      urls: totalCounts.urls + counts.urls,
      tokens: totalCounts.tokens + counts.tokens,
      emails: totalCounts.emails + counts.emails,
      clientIds: totalCounts.clientIds + counts.clientIds,
      purchaseIds: totalCounts.purchaseIds + counts.purchaseIds,
      authLinks: totalCounts.authLinks + counts.authLinks,
    }

    if (!dryRun && text !== original) {
      await fs.writeFile(filePath, text, 'utf8')
      console.log(`scrubbed: ${filePath} -> ${formatCounts(counts)}`)
    } else if (dryRun && text !== original) {
      console.log(`dry-run: ${filePath} -> ${formatCounts(counts)}`)
    }
  }

  const summaryLabel = dryRun ? 'dry-run summary' : 'summary'
  console.log(`${summaryLabel}: ${formatCounts(totalCounts)}`)
}

main().catch(error => {
  console.error('Failed to deep scrub PII:', error)
  process.exit(1)
})
