#!/usr/bin/env bun

import * as fs from 'node:fs/promises'
import * as path from 'node:path'
const OLLAMA_ENDPOINT = 'http://localhost:11434/api/embeddings'
const QDRANT_ENDPOINT = 'http://localhost:6333'
const QDRANT_COLLECTION = 'skills'

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const CONVERSATIONS_DUCKDB = path.join(
  process.cwd(),
  'artifacts/phase-0/embeddings/v2/temp.duckdb'
)
const SKILLS_INDEX = path.join(process.cwd(), 'skills/index.json')
const OUTPUT_DIR = path.join(process.cwd(), 'artifacts/gap-analysis')
const OUTPUT_REPORT = path.join(OUTPUT_DIR, 'report.md')
const OUTPUT_GAPS = path.join(OUTPUT_DIR, 'gaps.json')

const EMBEDDING_MODEL = 'mxbai-embed-large'
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

async function getOllamaEmbedding(prompt: string): Promise<number[]> {
  const response = await fetch(OLLAMA_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: EMBEDDING_MODEL, prompt }),
  })
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Ollama embedding failed (${response.status}): ${body}`)
  }
  const data = (await response.json()) as { embedding?: number[] }
  if (!data.embedding || data.embedding.length === 0) {
    throw new Error('Ollama embedding response missing embedding array')
  }
  return data.embedding
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

async function searchNearestSkill(
  vector: number[]
): Promise<{ name: string; description: string; score: number }> {
  const response = await fetch(
    `${QDRANT_ENDPOINT}/collections/${QDRANT_COLLECTION}/points/search`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vector,
        limit: 1,
        with_payload: true,
      }),
    }
  )
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Qdrant search failed (${response.status}): ${body}`)
  }
  const data = (await response.json()) as {
    result?: Array<{ score: number; payload?: { name?: string; description?: string } }>
  }
  const hit = data.result?.[0]
  if (!hit || !hit.payload?.name) {
    throw new Error('Qdrant search returned no results for skills collection')
  }
  return {
    name: hit.payload.name,
    description: hit.payload.description ?? '',
    score: hit.score,
  }
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

  const skillEmbeddings: SkillEmbedding[] = skillIndex.skills.map((skill) => ({
    name: skill.name,
    description: skill.description,
    embedding: [],
    embeddingNorm: 0,
  }))

  const duckdb = await loadDuckDB()
  const db = new duckdb.Database(CONVERSATIONS_DUCKDB)
  const rows = await queryAll<{
    conversation_id: string
    first_message: string
  }>(
    db,
    'SELECT conversation_id, first_message FROM conversations'
  )

  const gaps: GapRecord[] = []
  const totalConversations = rows.length

  for (const row of rows) {
    if (!row.first_message) continue
    const embedding = await getOllamaEmbedding(row.first_message)
    const { vector: normalized, norm } = normalizeVector(embedding)
    const nearest = await searchNearestSkill(embedding)

    if (nearest.score < SIMILARITY_THRESHOLD) {
      gaps.push({
        conversation_id: row.conversation_id,
        nearest_skill: nearest.name,
        similarity: Number(nearest.score.toFixed(4)),
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
  reportLines.push(`Embedding strategy: ollama-${EMBEDDING_MODEL}`)
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
