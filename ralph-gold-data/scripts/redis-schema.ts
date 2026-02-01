/**
 * Redis template storage schema
 * 
 * Key structure:
 * - template:{category}:{id} - individual template JSON
 * - template:index:{category} - sorted set of template IDs by confidence
 * - template:patterns - hash for pattern lookups
 * 
 * Note: For production, consider using Upstash Vector Store (see packages/core/src/templates/)
 * for semantic similarity search. This module provides a simpler Redis-based approach.
 */

import { createClient, type RedisClientType } from 'redis'

// ============================================================================
// Types
// ============================================================================

export interface TemplateVariable {
  name: string
  source: 'customer_message' | 'purchase_data' | 'config'
}

export interface Template {
  id: string
  conversationId?: string
  pattern: string
  template: string
  variables: TemplateVariable[]
  category: string
  confidence: number
  source?: string
  createdAt: string
  updatedAt: string
}

export interface TemplateMatch {
  template: Template
  score: number
}

// ============================================================================
// Redis Key Helpers
// ============================================================================

const KEYS = {
  template: (category: string, id: string) => `template:${category}:${id}`,
  categoryIndex: (category: string) => `template:index:${category}`,
  patternHash: () => `template:patterns`,
  allCategories: () => `template:categories`,
} as const

// ============================================================================
// Client Management
// ============================================================================

let client: RedisClientType | null = null

export async function getRedisClient(): Promise<RedisClientType> {
  if (client && client.isOpen) {
    return client
  }
  
  const url = process.env.REDIS_URL || 'redis://localhost:6379'
  client = createClient({ url })
  
  client.on('error', (err) => console.error('Redis Client Error:', err))
  
  await client.connect()
  return client
}

export async function closeRedisClient(): Promise<void> {
  if (client && client.isOpen) {
    await client.quit()
    client = null
  }
}

// ============================================================================
// Template CRUD Operations
// ============================================================================

/**
 * Store a template in Redis
 */
export async function storeTemplate(template: Template): Promise<void> {
  const redis = await getRedisClient()
  const key = KEYS.template(template.category, template.id)
  
  // Store template JSON
  await redis.set(key, JSON.stringify({
    ...template,
    updatedAt: new Date().toISOString()
  }))
  
  // Add to category index (sorted by confidence)
  await redis.zAdd(KEYS.categoryIndex(template.category), {
    score: template.confidence,
    value: template.id
  })
  
  // Store pattern for lookup
  await redis.hSet(KEYS.patternHash(), template.id, template.pattern)
  
  // Track category
  await redis.sAdd(KEYS.allCategories(), template.category)
}

/**
 * Get a template by ID
 */
export async function getTemplate(category: string, id: string): Promise<Template | null> {
  const redis = await getRedisClient()
  const data = await redis.get(KEYS.template(category, id))
  
  if (!data) return null
  
  try {
    return JSON.parse(data) as Template
  } catch {
    return null
  }
}

/**
 * Get templates by category, sorted by confidence (highest first)
 */
export async function getTemplatesByCategory(
  category: string,
  limit = 10
): Promise<Template[]> {
  const redis = await getRedisClient()
  
  // Get IDs sorted by confidence (high to low)
  const ids = await redis.zRange(
    KEYS.categoryIndex(category),
    0,
    limit - 1,
    { REV: true }
  )
  
  if (ids.length === 0) return []
  
  // Fetch each template
  const templates: Template[] = []
  for (const id of ids) {
    const template = await getTemplate(category, id)
    if (template) templates.push(template)
  }
  
  return templates
}

/**
 * Find templates with similar patterns (basic substring matching)
 * For production, use vector similarity via Upstash
 */
export async function findSimilarTemplates(
  query: string,
  options: { limit?: number; minScore?: number } = {}
): Promise<TemplateMatch[]> {
  const { limit = 5, minScore = 0.3 } = options
  const redis = await getRedisClient()
  
  // Get all patterns
  const patterns = await redis.hGetAll(KEYS.patternHash())
  
  // Simple fuzzy matching (for production, use embeddings)
  const matches: TemplateMatch[] = []
  const queryLower = query.toLowerCase()
  const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2)
  
  for (const [id, pattern] of Object.entries(patterns)) {
    const patternLower = pattern.toLowerCase()
    
    // Score based on word overlap
    let matchCount = 0
    for (const word of queryWords) {
      if (patternLower.includes(word)) matchCount++
    }
    
    const score = queryWords.length > 0 ? matchCount / queryWords.length : 0
    
    if (score >= minScore) {
      // Need to find the category for this template
      const categories = await redis.sMembers(KEYS.allCategories())
      
      for (const category of categories) {
        const template = await getTemplate(category, id)
        if (template) {
          matches.push({ template, score })
          break
        }
      }
    }
  }
  
  // Sort by score and limit
  return matches
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

/**
 * Delete a template
 */
export async function deleteTemplate(category: string, id: string): Promise<boolean> {
  const redis = await getRedisClient()
  
  const deleted = await redis.del(KEYS.template(category, id))
  await redis.zRem(KEYS.categoryIndex(category), id)
  await redis.hDel(KEYS.patternHash(), id)
  
  return deleted > 0
}

/**
 * Get all categories with template counts
 */
export async function getCategoryStats(): Promise<Map<string, number>> {
  const redis = await getRedisClient()
  const categories = await redis.sMembers(KEYS.allCategories())
  
  const stats = new Map<string, number>()
  for (const category of categories) {
    const count = await redis.zCard(KEYS.categoryIndex(category))
    stats.set(category, count)
  }
  
  return stats
}

// ============================================================================
// Bulk Operations
// ============================================================================

/**
 * Store multiple templates (with pipeline for efficiency)
 */
export async function storeTemplates(templates: Template[]): Promise<number> {
  const redis = await getRedisClient()
  let stored = 0
  
  // Use pipeline for batch operations
  const pipeline = redis.multi()
  
  for (const template of templates) {
    const key = KEYS.template(template.category, template.id)
    const data = JSON.stringify({
      ...template,
      updatedAt: new Date().toISOString()
    })
    
    pipeline.set(key, data)
    pipeline.zAdd(KEYS.categoryIndex(template.category), {
      score: template.confidence,
      value: template.id
    })
    pipeline.hSet(KEYS.patternHash(), template.id, template.pattern)
    pipeline.sAdd(KEYS.allCategories(), template.category)
    
    stored++
  }
  
  await pipeline.exec()
  return stored
}

/**
 * Clear all template data
 */
export async function clearAllTemplates(): Promise<void> {
  const redis = await getRedisClient()
  const categories = await redis.sMembers(KEYS.allCategories())
  
  const pipeline = redis.multi()
  
  for (const category of categories) {
    // Get all template IDs in category
    const ids = await redis.zRange(KEYS.categoryIndex(category), 0, -1)
    
    for (const id of ids) {
      pipeline.del(KEYS.template(category, id))
    }
    pipeline.del(KEYS.categoryIndex(category))
  }
  
  pipeline.del(KEYS.patternHash())
  pipeline.del(KEYS.allCategories())
  
  await pipeline.exec()
}

// Export key helpers for testing
export { KEYS }
