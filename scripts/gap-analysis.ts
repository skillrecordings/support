#!/usr/bin/env bun

import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import OpenAI from 'openai'

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const CONVERSATIONS_PARQUET = path.join(
  process.cwd(),
  'artifacts/phase-0/embeddings/v2/conversations.parquet'
)
const SKILLS_INDEX = path.join(process.cwd(), 'skills/index.json')
const OUTPUT_DIR = path.join(process.cwd(), 'artifacts/gap-analysis')
const OUTPUT_REPORT = path.join(OUTPUT_DIR, 'report.md')
const OUTPUT_GAPS = path.join(OUTPUT_DIR, 'gaps.json')

const EMBEDDING_MODEL = 'text-embedding-3-small'
const LOCAL_EMBEDDING_DIMENSIONS = 512
const SIMILARITY_THRESHOLD = 0.5
const MAX_CLUSTERS = 10
const EXAMPLES_PER_CLUSTER = 3
const MAX_KEYWORDS = 5
const MAX_SNIPPET_LENGTH = 220

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SkillIndexEntry {
  name: string
  description: string
}

interface ConversationRow {
  conversation_id: string
  first_message: string
  embedding: number[]
}

interface SkillEmbedding {
  name: string
  description: string
  embedding: number[]
  embeddingNorm: number
}

interface GapRecord {
  conversation_id: string
  nearest_skill: string
  similarity: number
  cluster_id: number | null
  first_message: string
  embedding: number[]
  embeddingNorm: number
}

interface ClusterSummary {
  id: number
  size: number
  examples: GapRecord[]
  keywords: string[]
  suggested_skill: string
}

// ---------------------------------------------------------------------------
// DuckDB helpers
// ---------------------------------------------------------------------------

type DuckDB = typeof import('duckdb')

async function loadDuckDB(): Promise<DuckDB> {
  try {
    return await import('duckdb')
  } catch {
    throw new Error(
      'DuckDB is not installed. Run: bun add duckdb (native module, requires compilation)'
    )
  }
}

function queryAll<T>(
  db: InstanceType<DuckDB['Database']>,
  sql: string
): Promise<T[]> {
  return new Promise((resolve, reject) => {
    db.all(sql, (err: Error | null, rows: T[]) => {
      if (err) reject(err)
      else resolve(rows)
    })
  })
}

// ---------------------------------------------------------------------------
// Embeddings
// ---------------------------------------------------------------------------

let openai: OpenAI | null = null
const HAS_OPENAI_KEY = Boolean(process.env.OPENAI_API_KEY)

function getOpenAI(): OpenAI {
  if (!openai) openai = new OpenAI()
  return openai
}

async function getEmbeddings(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return []
  const client = getOpenAI()
  const response = await client.embeddings.create({
    model: EMBEDDING_MODEL,
    input: texts,
  })
  const sorted = response.data.sort((a, b) => a.index - b.index)
  return sorted.map((item) => item.embedding)
}

async function getEmbeddingsBatched(texts: string[], batchSize = 100): Promise<number[][]> {
  const embeddings: number[][] = []
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize)
    const batchEmbeddings = await getEmbeddings(batch)
    embeddings.push(...batchEmbeddings)
  }
  return embeddings
}

// ---------------------------------------------------------------------------
// Vector helpers
// ---------------------------------------------------------------------------

function normalizeVector(vector: number[]): { vector: number[]; norm: number } {
  let sum = 0
  for (const value of vector) sum += value * value
  const norm = Math.sqrt(sum) || 1
  const normalized = vector.map((value) => value / norm)
  return { vector: normalized, norm }
}

function fnv1aHash(input: string): number {
  let hash = 2166136261
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function hashingEmbedding(text: string, dimensions = LOCAL_EMBEDDING_DIMENSIONS): number[] {
  const vector = new Array(dimensions).fill(0)
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\\s-]/g, ' ')
    .split(/\\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
  for (const token of tokens) {
    const hash = fnv1aHash(token)
    const index = hash % dimensions
    const sign = hash % 2 === 0 ? 1 : -1
    vector[index] += sign
  }
  return vector
}

function cosineSimilarity(
  vectorA: number[],
  normA: number,
  vectorB: number[],
  normB: number
): number {
  let dot = 0
  const length = Math.min(vectorA.length, vectorB.length)
  for (let i = 0; i < length; i += 1) {
    dot += vectorA[i] * vectorB[i]
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (normA * normB)
}

function parseEmbedding(value: unknown): number[] {
  if (Array.isArray(value)) return value.map((item) => Number(item))
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.startsWith('[')) {
      try {
        return JSON.parse(trimmed)
      } catch {
        // fall through
      }
    }
    const parts = trimmed.split(',').map((part) => Number(part))
    if (parts.every((part) => Number.isFinite(part))) return parts
  }
  throw new Error('Unable to parse embedding value from DuckDB')
}

// ---------------------------------------------------------------------------
// Clustering
// ---------------------------------------------------------------------------

function selectInitialCentroids(vectors: number[][], k: number): number[][] {
  if (k >= vectors.length) return vectors.map((vector) => vector.slice())
  const centroids: number[][] = []
  for (let i = 0; i < k; i += 1) {
    const index = Math.floor((i * (vectors.length - 1)) / Math.max(1, k - 1))
    centroids.push(vectors[index].slice())
  }
  return centroids
}

function averageVectors(vectors: number[][], length: number): number[] {
  const centroid = new Array(length).fill(0)
  for (const vector of vectors) {
    for (let i = 0; i < length; i += 1) {
      centroid[i] += vector[i]
    }
  }
  if (vectors.length === 0) return centroid
  for (let i = 0; i < length; i += 1) {
    centroid[i] /= vectors.length
  }
  return centroid
}

function kmeans(vectors: number[][], k: number, maxIterations = 40): number[] {
  if (vectors.length === 0) return []
  const dimension = vectors[0].length
  let centroids = selectInitialCentroids(vectors, k)
  let assignments = new Array(vectors.length).fill(-1)

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    let changed = false
    for (let i = 0; i < vectors.length; i += 1) {
      let bestCluster = 0
      let bestDistance = Number.POSITIVE_INFINITY
      for (let c = 0; c < centroids.length; c += 1) {
        let distance = 0
        const centroid = centroids[c]
        const vector = vectors[i]
        for (let d = 0; d < dimension; d += 1) {
          const diff = vector[d] - centroid[d]
          distance += diff * diff
        }
        if (distance < bestDistance) {
          bestDistance = distance
          bestCluster = c
        }
      }
      if (assignments[i] !== bestCluster) {
        assignments[i] = bestCluster
        changed = true
      }
    }

    if (!changed) break

    const grouped: number[][][] = Array.from({ length: k }, () => [])
    for (let i = 0; i < vectors.length; i += 1) {
      grouped[assignments[i]].push(vectors[i])
    }
    centroids = grouped.map((group, idx) => {
      if (group.length === 0) return centroids[idx]
      return averageVectors(group, dimension)
    })
  }

  return assignments
}

// ---------------------------------------------------------------------------
// Keyword extraction
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'that',
  'this',
  'have',
  'has',
  'from',
  'into',
  'about',
  'your',
  'you',
  'but',
  'not',
  'are',
  'was',
  'were',
  'will',
  'can',
  'cant',
  "can't",
  'could',
  'would',
  'should',
  'they',
  'their',
  'them',
  'there',
  'here',
  'just',
  'like',
  'also',
  'been',
  'being',
  'when',
  'what',
  'which',
  'who',
  'how',
  'why',
  'its',
  "it's",
  'out',
  'our',
  'all',
  'any',
  'some',
  'more',
  'less',
  'over',
  'under',
  'please',
  'thanks',
  'thank',
  'hello',
  'hi',
  'hey',
  'still',
  'been',
  'been',
  're',
  've',
  'im',
  "i'm",
  'we',
  'us',
  'my',
  'mine',
  'me',
  'a',
  'an',
  'to',
  'of',
  'in',
  'on',
  'at',
  'is',
  'it',
])

function extractKeywords(texts: string[], maxKeywords = MAX_KEYWORDS): string[] {
  const counts = new Map<string, number>()
  for (const text of texts) {
    const tokens = text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3 && !STOP_WORDS.has(token))
    for (const token of tokens) {
      counts.set(token, (counts.get(token) ?? 0) + 1)
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxKeywords)
    .map(([token]) => token)
}

function toSuggestedSkill(keywords: string[], fallbackId: number): string {
  if (keywords.length === 0) return `gap-cluster-${fallbackId}`
  const slug = keywords
    .slice(0, 3)
    .map((keyword) => keyword.replace(/[^a-z0-9]+/g, '-'))
    .filter(Boolean)
    .join('-')
  return `${slug}-issue`
}

function truncateSnippet(text: string): string {
  const trimmed = text.replace(/\s+/g, ' ').trim()
  if (trimmed.length <= MAX_SNIPPET_LENGTH) return trimmed
  return `${trimmed.slice(0, MAX_SNIPPET_LENGTH - 3)}...`
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true })

  const skillIndexRaw = await fs.readFile(SKILLS_INDEX, 'utf-8')
  const skillIndex = JSON.parse(skillIndexRaw) as { skills: SkillIndexEntry[] }

  const skillTexts = skillIndex.skills.map(
    (skill) => `${skill.name}: ${skill.description}`
  )
  const skillEmbeddingsRaw = HAS_OPENAI_KEY
    ? await getEmbeddingsBatched(skillTexts)
    : skillTexts.map((text) => hashingEmbedding(text))
  const skillEmbeddings: SkillEmbedding[] = skillIndex.skills.map((skill, index) => {
    const embedding = skillEmbeddingsRaw[index]
    const { vector: normalized, norm } = normalizeVector(embedding)
    return {
      name: skill.name,
      description: skill.description,
      embedding: normalized,
      embeddingNorm: norm,
    }
  })

  const duckdb = await loadDuckDB()
  const db = new duckdb.Database(':memory:')
  const rows = await queryAll<{
    conversation_id: string
    first_message: string
    embedding: unknown
  }>(
    db,
    `SELECT conversation_id, first_message, embedding FROM '${CONVERSATIONS_PARQUET}'`
  )

  const gaps: GapRecord[] = []
  const totalConversations = rows.length

  for (const row of rows) {
    if (!row.first_message) continue
    let embedding: number[] | null = null
    if (HAS_OPENAI_KEY) {
      if (!row.embedding) continue
      embedding = parseEmbedding(row.embedding)
    } else {
      embedding = hashingEmbedding(row.first_message)
    }
    const { vector: normalized, norm } = normalizeVector(embedding)

    let bestSkill = skillEmbeddings[0]
    let bestSimilarity = cosineSimilarity(
      normalized,
      norm,
      bestSkill.embedding,
      bestSkill.embeddingNorm
    )

    for (let i = 1; i < skillEmbeddings.length; i += 1) {
      const skill = skillEmbeddings[i]
      const similarity = cosineSimilarity(normalized, norm, skill.embedding, skill.embeddingNorm)
      if (similarity > bestSimilarity) {
        bestSimilarity = similarity
        bestSkill = skill
      }
    }

    if (bestSimilarity < SIMILARITY_THRESHOLD) {
      gaps.push({
        conversation_id: row.conversation_id,
        nearest_skill: bestSkill.name,
        similarity: Number(bestSimilarity.toFixed(4)),
        cluster_id: null,
        first_message: row.first_message,
        embedding: normalized,
        embeddingNorm: norm,
      })
    }
  }

  const gapVectors = gaps.map((gap) => gap.embedding)
  const clusterCount = Math.min(MAX_CLUSTERS, Math.max(1, gapVectors.length))
  const assignments = gapVectors.length ? kmeans(gapVectors, clusterCount) : []

  for (let i = 0; i < gaps.length; i += 1) {
    gaps[i].cluster_id = assignments[i] ?? null
  }

  const clusters: ClusterSummary[] = []
  for (let clusterId = 0; clusterId < clusterCount; clusterId += 1) {
    const clusterGaps = gaps.filter((gap) => gap.cluster_id === clusterId)
    if (clusterGaps.length === 0) continue
    const keywords = extractKeywords(clusterGaps.map((gap) => gap.first_message))
    const suggestedSkill = toSuggestedSkill(keywords, clusterId + 1)
    const examples = [...clusterGaps]
      .sort((a, b) => a.similarity - b.similarity)
      .slice(0, EXAMPLES_PER_CLUSTER)
    clusters.push({
      id: clusterId,
      size: clusterGaps.length,
      examples,
      keywords,
      suggested_skill: suggestedSkill,
    })
  }

  clusters.sort((a, b) => b.size - a.size)

  const topClusters = clusters.slice(0, MAX_CLUSTERS)

  const suggestedSkills = topClusters.map((cluster) =>
    `- ${cluster.suggested_skill} (cluster ${cluster.id + 1}, ${cluster.size} tickets, keywords: ${cluster.keywords.join(', ') || 'n/a'})`
  )

  const reportLines: string[] = []
  reportLines.push('# Gap Analysis Report')
  reportLines.push('')
  reportLines.push(`Generated: ${new Date().toISOString()}`)
  reportLines.push('')
  reportLines.push(`Total conversations analyzed: ${totalConversations}`)
  reportLines.push(`Total gaps found (similarity < ${SIMILARITY_THRESHOLD}): ${gaps.length}`)
  reportLines.push(`Skills compared: ${skillEmbeddings.length}`)
  reportLines.push(`Embedding strategy: ${HAS_OPENAI_KEY ? EMBEDDING_MODEL : `local-hash-${LOCAL_EMBEDDING_DIMENSIONS}`}`)
  reportLines.push(`Clusters generated: ${clusterCount}`)
  reportLines.push('')
  reportLines.push('## Top Gap Clusters')
  reportLines.push('')

  if (topClusters.length === 0) {
    reportLines.push('No gaps found below the similarity threshold.')
  } else {
    for (const cluster of topClusters) {
      reportLines.push(`### Cluster ${cluster.id + 1} (${cluster.size} tickets)`)
      reportLines.push(`Suggested skill: ${cluster.suggested_skill}`)
      reportLines.push(`Keywords: ${cluster.keywords.join(', ') || 'n/a'}`)
      reportLines.push('Examples:')
      for (const example of cluster.examples) {
        reportLines.push(
          `- ${example.conversation_id} (nearest: ${example.nearest_skill}, similarity: ${example.similarity})\n  ${truncateSnippet(example.first_message)}`
        )
      }
      reportLines.push('')
    }
  }

  reportLines.push('## Suggested New Skills')
  reportLines.push('')
  if (suggestedSkills.length === 0) {
    reportLines.push('No suggested skills (no gap clusters found).')
  } else {
    reportLines.push(...suggestedSkills)
  }

  await fs.writeFile(OUTPUT_REPORT, reportLines.join('\n'))

  const gapOutput = gaps.map(({ embedding, embeddingNorm, first_message, ...rest }) => ({
    ...rest,
  }))
  await fs.writeFile(OUTPUT_GAPS, JSON.stringify(gapOutput, null, 2))

  console.log(`Gap analysis complete. Report: ${OUTPUT_REPORT}`)
  console.log(`Gap list: ${OUTPUT_GAPS}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
