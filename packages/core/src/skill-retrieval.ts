import { Redis } from '@upstash/redis'
import { Index } from '@upstash/vector'

export interface SkillData {
  skill_id: string
  name: string
  description: string
  path: string
  sample_size?: number
  markdown?: string
  indexed_at: string
}

export interface RetrievedSkill extends SkillData {
  score: number // Semantic similarity score
}

export interface RetrievalOptions {
  topK?: number
  minScore?: number
  includeMarkdown?: boolean
}

/**
 * Retrieve skills relevant to a query.
 * Uses Vector for semantic search, Redis for full content.
 */
export async function retrieveSkills(
  query: string,
  options: RetrievalOptions = {}
): Promise<RetrievedSkill[]> {
  const { topK = 3, minScore = 0.01, includeMarkdown = true } = options

  // Get clients from environment
  const vectorUrl = process.env.UPSTASH_VECTOR_REST_URL
  const vectorToken = process.env.UPSTASH_VECTOR_REST_TOKEN
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN

  if (!vectorUrl || !vectorToken || !redisUrl || !redisToken) {
    throw new Error('Missing Upstash credentials in environment')
  }

  const vector = new Index({ url: vectorUrl, token: vectorToken })
  const redis = new Redis({ url: redisUrl, token: redisToken })

  // Step 1: Semantic search in Vector
  const skillsNs = vector.namespace('skills')
  const vectorResults = await skillsNs.query({
    data: query,
    topK,
    includeMetadata: true,
  })

  // Filter by minimum score
  const relevantResults = vectorResults.filter((r) => r.score >= minScore)

  if (relevantResults.length === 0) {
    return []
  }

  // Step 2: Fetch full content from Redis
  const skillIds = relevantResults.map((r) => r.id as string)
  const redisResults = await redis.mget<SkillData[]>(...skillIds)

  // Step 3: Combine Vector scores with Redis content
  const skills: RetrievedSkill[] = []

  for (let i = 0; i < relevantResults.length; i++) {
    const vectorResult = relevantResults[i]
    const redisData = redisResults[i] as SkillData | null

    if (!vectorResult) {
      continue
    }

    if (redisData) {
      // Redis client auto-parses JSON, so redisData is already an object
      const skillData: SkillData = redisData

      // Optionally strip markdown to reduce token usage
      if (!includeMarkdown && skillData.markdown) {
        delete skillData.markdown
      }

      skills.push({
        ...skillData,
        score: vectorResult.score,
      })
    }
  }

  return skills
}

/**
 * Format skills for inclusion in LLM context
 */
export function formatSkillsForContext(skills: RetrievedSkill[]): string {
  if (skills.length === 0) {
    return 'No relevant skills found.'
  }

  return skills
    .map((skill, i) => {
      const header = `## Skill ${i + 1}: ${skill.name} (relevance: ${(skill.score * 100).toFixed(1)}%)`
      const description = skill.description
      const markdown = skill.markdown
        ? `\n\n### Full Documentation:\n${skill.markdown}`
        : ''

      return `${header}\n${description}${markdown}`
    })
    .join('\n\n---\n\n')
}
