#!/usr/bin/env bun

import * as fs from 'node:fs/promises'
import * as path from 'node:path'

const SKILLS_DIR = path.join(process.cwd(), 'skills')
const QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6333'
const QDRANT_COLLECTION = 'skills'
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434'
const EMBEDDING_MODEL = 'mxbai-embed-large'
const VECTOR_SIZE = 1024

interface FrontmatterParseResult {
  name?: string
  description?: string
  metadata?: Record<string, string>
  errors: string[]
}

interface SkillRecord {
  name: string
  description: string
  metadata: Record<string, string>
  filePath: string
}

interface QdrantPoint {
  id: number
  vector: number[]
  payload: Record<string, unknown>
}

function stripQuotes(value: string): string {
  return value.replace(/^['"]|['"]$/g, '').trim()
}

function parseMetadata(
  lines: string[],
  startIndex: number
): { metadata: Record<string, string>; endIndex: number; errors: string[] } {
  const metadata: Record<string, string> = {}
  const errors: string[] = []
  let index = startIndex + 1
  for (; index < lines.length; index += 1) {
    const line = lines[index]
    if (line.trim() === '') continue
    if (!line.startsWith(' ') && !line.startsWith('\t')) {
      break
    }
    const trimmed = line.replace(/^\s+/, '')
    const separatorIndex = trimmed.indexOf(':')
    if (separatorIndex === -1) {
      errors.push(`metadata entry is missing ':' on line ${index + 1}`)
      continue
    }
    const key = trimmed.slice(0, separatorIndex).trim()
    const value = trimmed.slice(separatorIndex + 1).trim()
    if (!key) {
      errors.push(`metadata entry has empty key on line ${index + 1}`)
      continue
    }
    metadata[key] = stripQuotes(value)
  }
  return { metadata, endIndex: index - 1, errors }
}

function parseFrontmatter(frontmatter: string): FrontmatterParseResult {
  const lines = frontmatter.split(/\r?\n/)
  const result: FrontmatterParseResult = { errors: [] }

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    if (!line.trim()) continue
    if (line.startsWith(' ') || line.startsWith('\t')) continue

    const separatorIndex = line.indexOf(':')
    if (separatorIndex === -1) continue

    const key = line.slice(0, separatorIndex).trim()
    const rawValue = line.slice(separatorIndex + 1).trim()

    if (key === 'name') {
      result.name = stripQuotes(rawValue)
      continue
    }

    if (key === 'description') {
      result.description = stripQuotes(rawValue)
      continue
    }

    if (key === 'metadata') {
      if (rawValue && rawValue !== '|' && rawValue !== '>') {
        result.errors.push('metadata must be a key-value map, not a scalar')
        continue
      }
      const parsed = parseMetadata(lines, i)
      result.metadata = parsed.metadata
      result.errors.push(...parsed.errors)
      i = parsed.endIndex
    }
  }

  return result
}

function getFrontmatterSections(content: string): {
  frontmatter?: string
  errors: string[]
} {
  const errors: string[] = []
  const trimmed = content.trimStart()
  if (!trimmed.startsWith('---')) {
    return { errors: ['missing frontmatter delimiter'] }
  }

  const lines = content.split(/\r?\n/)
  if (lines[0].trim() !== '---') {
    return { errors: ['frontmatter must start at first line'] }
  }

  let endIndex = -1
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === '---') {
      endIndex = i
      break
    }
  }

  if (endIndex === -1) {
    return { errors: ['missing closing frontmatter delimiter'] }
  }

  const frontmatter = lines.slice(1, endIndex).join('\n')
  return { frontmatter, errors }
}

async function ensureCollection(): Promise<void> {
  const existsRes = await fetch(
    `${QDRANT_URL}/collections/${QDRANT_COLLECTION}`
  )

  if (existsRes.status === 404) {
    await createCollection()
    return
  }

  if (!existsRes.ok) {
    const error = await existsRes.text()
    throw new Error(`Failed to check Qdrant collection: ${error}`)
  }

  const data = (await existsRes.json()) as {
    result?: {
      config?: { params?: { vectors?: unknown } }
    }
  }
  const vectorConfig = data.result?.config?.params?.vectors

  let size: number | undefined
  let distance: string | undefined

  if (vectorConfig && typeof vectorConfig === 'object') {
    if ('size' in vectorConfig) {
      const rawSize = (vectorConfig as { size?: unknown }).size
      if (typeof rawSize === 'number') size = rawSize
      const rawDistance = (vectorConfig as { distance?: unknown }).distance
      if (typeof rawDistance === 'string') distance = rawDistance
    } else {
      const entries = Object.values(
        vectorConfig as Record<string, { size?: number; distance?: string }>
      )
      const defaultConfig = entries[0]
      if (defaultConfig) {
        size = defaultConfig.size
        distance = defaultConfig.distance
      }
    }
  }

  if (size !== VECTOR_SIZE || (distance ?? '').toLowerCase() !== 'cosine') {
    console.warn(
      `Recreating collection due to config mismatch (size ${size}, distance ${distance}).`
    )
    await deleteCollection()
    await createCollection()
  }
}

async function createCollection(): Promise<void> {
  const createRes = await fetch(
    `${QDRANT_URL}/collections/${QDRANT_COLLECTION}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vectors: { size: VECTOR_SIZE, distance: 'Cosine' },
      }),
    }
  )

  if (!createRes.ok) {
    const error = await createRes.text()
    throw new Error(`Failed to create Qdrant collection: ${error}`)
  }
}

async function deleteCollection(): Promise<void> {
  const deleteRes = await fetch(
    `${QDRANT_URL}/collections/${QDRANT_COLLECTION}`,
    { method: 'DELETE' }
  )

  if (!deleteRes.ok) {
    const error = await deleteRes.text()
    throw new Error(`Failed to delete Qdrant collection: ${error}`)
  }
}

async function getEmbedding(text: string): Promise<number[]> {
  const res = await fetch(`${OLLAMA_URL}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: EMBEDDING_MODEL, prompt: text }),
  })

  if (!res.ok) {
    const error = await res.text()
    throw new Error(`Ollama embedding failed: ${error}`)
  }

  const data = (await res.json()) as { embedding?: number[] }
  if (!data.embedding || data.embedding.length === 0) {
    throw new Error('Ollama embedding response missing embedding')
  }
  if (data.embedding.length !== VECTOR_SIZE) {
    throw new Error(
      `Unexpected embedding size: ${data.embedding.length} (expected ${VECTOR_SIZE})`
    )
  }
  return data.embedding
}

async function loadSkills(): Promise<SkillRecord[]> {
  const entries = await fs.readdir(SKILLS_DIR, { withFileTypes: true })
  const skillDirs = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b))

  const skills: SkillRecord[] = []

  for (const dirName of skillDirs) {
    const skillPath = path.join(SKILLS_DIR, dirName, 'SKILL.md')
    let content = ''
    try {
      content = await fs.readFile(skillPath, 'utf-8')
    } catch (error) {
      console.warn(`Skipping ${dirName}: unable to read SKILL.md`)
      if (error instanceof Error) console.warn(`  ${error.message}`)
      continue
    }

    const sections = getFrontmatterSections(content)
    if (sections.errors.length > 0 || !sections.frontmatter) {
      console.warn(`Skipping ${dirName}: ${sections.errors.join(', ')}`)
      continue
    }

    const frontmatter = parseFrontmatter(sections.frontmatter)
    if (frontmatter.errors.length > 0) {
      console.warn(`Warnings for ${dirName}: ${frontmatter.errors.join(', ')}`)
    }

    if (!frontmatter.name || !frontmatter.description) {
      console.warn(`Skipping ${dirName}: missing name or description`)
      continue
    }

    skills.push({
      name: frontmatter.name,
      description: frontmatter.description,
      metadata: frontmatter.metadata ?? {},
      filePath: skillPath,
    })
  }

  return skills
}

function parseSampleSize(value?: string): number | string | undefined {
  if (!value) return undefined
  const parsed = Number(value)
  if (Number.isFinite(parsed)) return parsed
  return value
}

async function upsertPoints(points: QdrantPoint[]): Promise<void> {
  const res = await fetch(
    `${QDRANT_URL}/collections/${QDRANT_COLLECTION}/points`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        points: points.map((point) => ({
          id: point.id,
          vector: point.vector,
          payload: point.payload,
        })),
      }),
    }
  )

  if (!res.ok) {
    const error = await res.text()
    throw new Error(`Failed to upsert points: ${error}`)
  }
}

async function main(): Promise<void> {
  console.log('Ensuring Qdrant collection...')
  await ensureCollection()

  console.log('Loading skills...')
  const skills = await loadSkills()
  if (skills.length === 0) {
    throw new Error('No skills found to embed')
  }

  const points: QdrantPoint[] = []
  for (const [index, skill] of skills.entries()) {
    console.log(`Embedding ${skill.name}...`)
    const embedding = await getEmbedding(skill.description)
    const sampleSize = parseSampleSize(skill.metadata.sample_size)

    points.push({
      id: index + 1,
      vector: embedding,
      payload: {
        name: skill.name,
        description: skill.description,
        path: path.relative(process.cwd(), skill.filePath),
        sample_size: sampleSize,
      },
    })
  }

  console.log(`Upserting ${points.length} skills to Qdrant...`)
  await upsertPoints(points)
  console.log('Done.')
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
