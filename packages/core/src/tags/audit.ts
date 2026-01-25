/**
 * Tag Audit Module
 *
 * Analyzes Front tags to find issues and generate recommendations:
 * - Exact duplicates
 * - Near-duplicates (fuzzy matching)
 * - Case variants
 * - Unused tags (0 conversations)
 * - Non-standard tags (not in TagRegistry)
 * - Categorization (countries, products, emojis, etc.)
 */

import type { Tag } from '@skillrecordings/front-sdk'
import { DEFAULT_CATEGORY_TAG_MAPPING } from './registry'

// ============================================================================
// Types
// ============================================================================

export interface TagWithConversationCount extends Tag {
  conversationCount: number
}

export interface AuditResult {
  totalTags: number
  exactDuplicates: DuplicateGroup[]
  nearDuplicates: NearDuplicateGroup[]
  caseVariants: CaseVariantGroup[]
  unusedTags: TagWithConversationCount[]
  nonStandardTags: TagWithConversationCount[]
  categorization: TagCategorization
  recommendations: AuditRecommendation[]
}

export interface DuplicateGroup {
  name: string
  tags: TagWithConversationCount[]
}

export interface NearDuplicateGroup {
  canonical: string
  variants: Array<{
    tag: TagWithConversationCount
    distance: number
    similarity: number
  }>
}

export interface CaseVariantGroup {
  normalizedName: string
  variants: TagWithConversationCount[]
}

export interface TagCategorization {
  countries: TagWithConversationCount[]
  products: TagWithConversationCount[]
  emojis: TagWithConversationCount[]
  statuses: TagWithConversationCount[]
  categories: TagWithConversationCount[]
  other: TagWithConversationCount[]
}

export interface AuditRecommendation {
  type:
    | 'merge'
    | 'delete'
    | 'rename'
    | 'standardize'
    | 'review'
    | 'archive'
    | 'keep'
  priority: 'high' | 'medium' | 'low'
  description: string
  affectedTags: string[]
  action?: string
}

// ============================================================================
// Known Data Sets for Categorization
// ============================================================================

const COUNTRY_PATTERNS = [
  // Common country names
  'australia',
  'austria',
  'belgium',
  'brazil',
  'canada',
  'china',
  'denmark',
  'finland',
  'france',
  'germany',
  'india',
  'ireland',
  'italy',
  'japan',
  'mexico',
  'netherlands',
  'new zealand',
  'norway',
  'poland',
  'portugal',
  'russia',
  'singapore',
  'south africa',
  'south korea',
  'spain',
  'sweden',
  'switzerland',
  'taiwan',
  'thailand',
  'turkey',
  'ukraine',
  'united kingdom',
  'united states',
  'uk',
  'us',
  'usa',
  // Country-related patterns
  'eu',
  'europe',
  'apac',
  'latam',
  'emea',
]

const PRODUCT_PATTERNS = [
  // Common product identifiers
  'epic-react',
  'epic-web',
  'testing-javascript',
  'just-javascript',
  'total-typescript',
  'pro-tailwind',
  'css-for-js',
  'joy-of-react',
  'badass-courses',
  'course',
  'workshop',
  'tutorial',
  'pro',
  'enterprise',
  'team',
  'individual',
]

const STATUS_PATTERNS = [
  'open',
  'closed',
  'pending',
  'resolved',
  'archived',
  'active',
  'inactive',
  'waiting',
  'blocked',
  'in-progress',
  'done',
  'todo',
  'review',
  'approved',
  'rejected',
  'needs-review',
  'awaiting-reply',
  'urgent',
  'priority',
  'escalated',
]

const CATEGORY_PATTERNS = [
  'support',
  'billing',
  'refund',
  'technical',
  'access',
  'transfer',
  'presales',
  'spam',
  'system',
  'fan-mail',
  'voc',
  'feedback',
  'bug',
  'feature',
  'question',
  'complaint',
  'inquiry',
]

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Calculate Levenshtein distance between two strings
 */
export function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = []

  // Initialize all rows first
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = new Array(a.length + 1).fill(0)
  }

  // Initialize first column
  for (let i = 0; i <= b.length; i++) {
    matrix[i]![0] = i
  }

  // Initialize first row
  for (let j = 0; j <= a.length; j++) {
    matrix[0]![j] = j
  }

  // Fill in the rest of the matrix
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      const row = matrix[i]!
      const prevRow = matrix[i - 1]!
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        row[j] = prevRow[j - 1]!
      } else {
        row[j] = Math.min(
          prevRow[j - 1]! + 1, // substitution
          row[j - 1]! + 1, // insertion
          prevRow[j]! + 1 // deletion
        )
      }
    }
  }

  return matrix[b.length]![a.length]!
}

/**
 * Calculate similarity ratio (0-1) between two strings
 */
export function similarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length)
  if (maxLen === 0) return 1
  const distance = levenshteinDistance(a, b)
  return 1 - distance / maxLen
}

/**
 * Normalize tag name for comparison
 */
export function normalizeTagName(name: string): string {
  return name.toLowerCase().replace(/[_-]/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * Check if tag name contains emoji
 */
export function containsEmoji(text: string): boolean {
  const emojiRegex =
    /[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/u
  return emojiRegex.test(text)
}

/**
 * Check if tag name matches a pattern list
 */
function matchesPattern(name: string, patterns: string[]): boolean {
  const normalized = normalizeTagName(name)
  return patterns.some(
    (pattern) =>
      normalized === pattern ||
      normalized.includes(pattern) ||
      pattern.includes(normalized)
  )
}

// ============================================================================
// Analysis Functions
// ============================================================================

/**
 * Find exact duplicates (same name, different IDs - shouldn't happen but check)
 */
export function findExactDuplicates(
  tags: TagWithConversationCount[]
): DuplicateGroup[] {
  const nameMap = new Map<string, TagWithConversationCount[]>()

  for (const tag of tags) {
    const normalized = normalizeTagName(tag.name)
    const existing = nameMap.get(normalized) || []
    existing.push(tag)
    nameMap.set(normalized, existing)
  }

  return Array.from(nameMap.entries())
    .filter(([_, tags]) => tags.length > 1)
    .map(([name, tags]) => ({ name, tags }))
}

/**
 * Find near-duplicates using fuzzy matching
 * Only groups tags with similarity >= threshold
 */
export function findNearDuplicates(
  tags: TagWithConversationCount[],
  threshold = 0.8
): NearDuplicateGroup[] {
  const groups: NearDuplicateGroup[] = []
  const processed = new Set<string>()

  for (const tag of tags) {
    if (processed.has(tag.id)) continue

    const normalized = normalizeTagName(tag.name)
    const variants: NearDuplicateGroup['variants'] = []

    for (const other of tags) {
      if (other.id === tag.id || processed.has(other.id)) continue

      const otherNormalized = normalizeTagName(other.name)
      const sim = similarity(normalized, otherNormalized)

      if (sim >= threshold && sim < 1) {
        // Not exact match but similar
        variants.push({
          tag: other,
          distance: levenshteinDistance(normalized, otherNormalized),
          similarity: sim,
        })
        processed.add(other.id)
      }
    }

    if (variants.length > 0) {
      processed.add(tag.id)
      groups.push({
        canonical: tag.name,
        variants: variants.sort((a, b) => b.similarity - a.similarity),
      })
    }
  }

  return groups
}

/**
 * Find case variants (same letters, different case)
 */
export function findCaseVariants(
  tags: TagWithConversationCount[]
): CaseVariantGroup[] {
  const caseMap = new Map<string, TagWithConversationCount[]>()

  for (const tag of tags) {
    const lowerName = tag.name.toLowerCase()
    const existing = caseMap.get(lowerName) || []
    existing.push(tag)
    caseMap.set(lowerName, existing)
  }

  return Array.from(caseMap.entries())
    .filter(([_, tags]) => {
      // Only include if there are actual case differences
      const names = new Set(tags.map((t) => t.name))
      return names.size > 1
    })
    .map(([normalizedName, variants]) => ({
      normalizedName,
      variants,
    }))
}

/**
 * Find unused tags (0 conversations)
 */
export function findUnusedTags(
  tags: TagWithConversationCount[]
): TagWithConversationCount[] {
  return tags.filter((tag) => tag.conversationCount === 0)
}

/**
 * Find tags not in the standard TagRegistry mapping
 */
export function findNonStandardTags(
  tags: TagWithConversationCount[]
): TagWithConversationCount[] {
  const standardTagNames = new Set(
    Object.values(DEFAULT_CATEGORY_TAG_MAPPING).map((config) =>
      config.tagName.toLowerCase()
    )
  )

  return tags.filter((tag) => !standardTagNames.has(tag.name.toLowerCase()))
}

/**
 * Categorize tags by type
 */
export function categorizeTags(
  tags: TagWithConversationCount[]
): TagCategorization {
  const result: TagCategorization = {
    countries: [],
    products: [],
    emojis: [],
    statuses: [],
    categories: [],
    other: [],
  }

  for (const tag of tags) {
    const name = tag.name

    if (containsEmoji(name)) {
      result.emojis.push(tag)
    } else if (matchesPattern(name, COUNTRY_PATTERNS)) {
      result.countries.push(tag)
    } else if (matchesPattern(name, PRODUCT_PATTERNS)) {
      result.products.push(tag)
    } else if (matchesPattern(name, STATUS_PATTERNS)) {
      result.statuses.push(tag)
    } else if (matchesPattern(name, CATEGORY_PATTERNS)) {
      result.categories.push(tag)
    } else {
      result.other.push(tag)
    }
  }

  return result
}

/**
 * Generate recommendations based on audit findings
 */
export function generateRecommendations(
  exactDuplicates: DuplicateGroup[],
  nearDuplicates: NearDuplicateGroup[],
  caseVariants: CaseVariantGroup[],
  unusedTags: TagWithConversationCount[],
  nonStandardTags: TagWithConversationCount[]
): AuditRecommendation[] {
  const recommendations: AuditRecommendation[] = []

  // Exact duplicates - high priority merge
  for (const group of exactDuplicates) {
    const sorted = [...group.tags].sort(
      (a, b) => b.conversationCount - a.conversationCount
    )
    const keep = sorted[0]
    if (!keep) continue

    recommendations.push({
      type: 'merge',
      priority: 'high',
      description: `Exact duplicate: "${group.name}" appears ${group.tags.length} times`,
      affectedTags: group.tags.map((t) => t.name),
      action: `Keep "${keep.name}" (${keep.conversationCount} conversations), remove duplicates`,
    })
  }

  // Case variants - medium priority standardize
  for (const group of caseVariants) {
    const sorted = [...group.variants].sort(
      (a, b) => b.conversationCount - a.conversationCount
    )
    const canonical = sorted[0]
    if (!canonical) continue

    recommendations.push({
      type: 'standardize',
      priority: 'medium',
      description: `Case variants found: ${group.variants.map((t) => `"${t.name}"`).join(', ')}`,
      affectedTags: group.variants.map((t) => t.name),
      action: `Standardize to "${canonical.name}" (${canonical.conversationCount} conversations)`,
    })
  }

  // Near duplicates - medium priority review
  for (const group of nearDuplicates) {
    recommendations.push({
      type: 'review',
      priority: 'medium',
      description: `Potential duplicates of "${group.canonical}": ${group.variants.map((v) => `"${v.tag.name}" (${Math.round(v.similarity * 100)}%)`).join(', ')}`,
      affectedTags: [group.canonical, ...group.variants.map((v) => v.tag.name)],
      action: 'Review and merge if appropriate',
    })
  }

  // Unused tags - low priority delete/archive
  for (const tag of unusedTags) {
    // Check if it's a standard tag that should be kept
    const standardTagNames = new Set(
      Object.values(DEFAULT_CATEGORY_TAG_MAPPING).map((config) =>
        config.tagName.toLowerCase()
      )
    )

    if (standardTagNames.has(tag.name.toLowerCase())) {
      recommendations.push({
        type: 'keep',
        priority: 'low',
        description: `"${tag.name}" is unused but is a standard tag`,
        affectedTags: [tag.name],
        action: 'Keep (standard tag, may be used by automation)',
      })
    } else {
      recommendations.push({
        type: 'archive',
        priority: 'low',
        description: `"${tag.name}" has 0 conversations`,
        affectedTags: [tag.name],
        action: 'Consider deleting if no longer needed',
      })
    }
  }

  // Non-standard tags with low usage - low priority review
  const lowUsageNonStandard = nonStandardTags.filter(
    (t) => t.conversationCount < 10 && t.conversationCount > 0
  )
  if (lowUsageNonStandard.length > 0) {
    recommendations.push({
      type: 'review',
      priority: 'low',
      description: `${lowUsageNonStandard.length} non-standard tags with low usage (<10 conversations)`,
      affectedTags: lowUsageNonStandard.map((t) => t.name),
      action: 'Consider consolidating into standard categories',
    })
  }

  return recommendations.sort((a, b) => {
    const priorityOrder = { high: 0, medium: 1, low: 2 }
    return priorityOrder[a.priority] - priorityOrder[b.priority]
  })
}

// ============================================================================
// Main Audit Function
// ============================================================================

/**
 * Run a full tag audit
 *
 * @param tags - Array of tags with conversation counts
 * @returns Complete audit result with findings and recommendations
 */
export function runTagAudit(tags: TagWithConversationCount[]): AuditResult {
  const exactDuplicates = findExactDuplicates(tags)
  const nearDuplicates = findNearDuplicates(tags)
  const caseVariants = findCaseVariants(tags)
  const unusedTags = findUnusedTags(tags)
  const nonStandardTags = findNonStandardTags(tags)
  const categorization = categorizeTags(tags)
  const recommendations = generateRecommendations(
    exactDuplicates,
    nearDuplicates,
    caseVariants,
    unusedTags,
    nonStandardTags
  )

  return {
    totalTags: tags.length,
    exactDuplicates,
    nearDuplicates,
    caseVariants,
    unusedTags,
    nonStandardTags,
    categorization,
    recommendations,
  }
}

// ============================================================================
// Markdown Report Generator
// ============================================================================

/**
 * Generate a markdown report from audit results
 */
export function generateMarkdownReport(result: AuditResult): string {
  const lines: string[] = []

  lines.push('# Tag Audit Report')
  lines.push('')
  lines.push(`Generated: ${new Date().toISOString()}`)
  lines.push('')

  // Summary
  lines.push('## Summary')
  lines.push('')
  lines.push(`- **Total Tags:** ${result.totalTags}`)
  lines.push(`- **Exact Duplicates:** ${result.exactDuplicates.length} groups`)
  lines.push(`- **Near Duplicates:** ${result.nearDuplicates.length} groups`)
  lines.push(`- **Case Variants:** ${result.caseVariants.length} groups`)
  lines.push(`- **Unused Tags:** ${result.unusedTags.length}`)
  lines.push(`- **Non-Standard Tags:** ${result.nonStandardTags.length}`)
  lines.push('')

  // Recommendations
  if (result.recommendations.length > 0) {
    lines.push('## Recommendations')
    lines.push('')

    const highPriority = result.recommendations.filter(
      (r) => r.priority === 'high'
    )
    const mediumPriority = result.recommendations.filter(
      (r) => r.priority === 'medium'
    )
    const lowPriority = result.recommendations.filter(
      (r) => r.priority === 'low'
    )

    if (highPriority.length > 0) {
      lines.push('### 🔴 High Priority')
      lines.push('')
      for (const rec of highPriority) {
        lines.push(`- **${rec.type.toUpperCase()}**: ${rec.description}`)
        if (rec.action) lines.push(`  - Action: ${rec.action}`)
      }
      lines.push('')
    }

    if (mediumPriority.length > 0) {
      lines.push('### 🟡 Medium Priority')
      lines.push('')
      for (const rec of mediumPriority) {
        lines.push(`- **${rec.type.toUpperCase()}**: ${rec.description}`)
        if (rec.action) lines.push(`  - Action: ${rec.action}`)
      }
      lines.push('')
    }

    if (lowPriority.length > 0) {
      lines.push('### 🟢 Low Priority')
      lines.push('')
      for (const rec of lowPriority) {
        lines.push(`- **${rec.type.toUpperCase()}**: ${rec.description}`)
        if (rec.action) lines.push(`  - Action: ${rec.action}`)
      }
      lines.push('')
    }
  }

  // Exact Duplicates Detail
  if (result.exactDuplicates.length > 0) {
    lines.push('## Exact Duplicates')
    lines.push('')
    for (const group of result.exactDuplicates) {
      lines.push(`### "${group.name}"`)
      lines.push('')
      lines.push('| Tag ID | Name | Conversations |')
      lines.push('|--------|------|---------------|')
      for (const tag of group.tags) {
        lines.push(`| ${tag.id} | ${tag.name} | ${tag.conversationCount} |`)
      }
      lines.push('')
    }
  }

  // Case Variants Detail
  if (result.caseVariants.length > 0) {
    lines.push('## Case Variants')
    lines.push('')
    for (const group of result.caseVariants) {
      lines.push(`### Variants of "${group.normalizedName}"`)
      lines.push('')
      lines.push('| Name | Conversations |')
      lines.push('|------|---------------|')
      for (const tag of group.variants) {
        lines.push(`| ${tag.name} | ${tag.conversationCount} |`)
      }
      lines.push('')
    }
  }

  // Near Duplicates Detail
  if (result.nearDuplicates.length > 0) {
    lines.push('## Near Duplicates (Fuzzy Matches)')
    lines.push('')
    for (const group of result.nearDuplicates) {
      lines.push(`### Similar to "${group.canonical}"`)
      lines.push('')
      lines.push('| Name | Similarity | Distance | Conversations |')
      lines.push('|------|------------|----------|---------------|')
      for (const variant of group.variants) {
        lines.push(
          `| ${variant.tag.name} | ${Math.round(variant.similarity * 100)}% | ${variant.distance} | ${variant.tag.conversationCount} |`
        )
      }
      lines.push('')
    }
  }

  // Unused Tags
  if (result.unusedTags.length > 0) {
    lines.push('## Unused Tags (0 Conversations)')
    lines.push('')
    lines.push('| Name | ID |')
    lines.push('|------|----|')
    for (const tag of result.unusedTags) {
      lines.push(`| ${tag.name} | ${tag.id} |`)
    }
    lines.push('')
  }

  // Tag Categorization
  lines.push('## Tag Categorization')
  lines.push('')

  const cats = result.categorization
  const catSections = [
    { name: 'Categories', tags: cats.categories },
    { name: 'Statuses', tags: cats.statuses },
    { name: 'Products', tags: cats.products },
    { name: 'Countries/Regions', tags: cats.countries },
    { name: 'Emoji Tags', tags: cats.emojis },
    { name: 'Other', tags: cats.other },
  ]

  for (const section of catSections) {
    if (section.tags.length > 0) {
      lines.push(`### ${section.name} (${section.tags.length})`)
      lines.push('')
      const sorted = [...section.tags].sort(
        (a, b) => b.conversationCount - a.conversationCount
      )
      const preview = sorted.slice(0, 10)
      for (const tag of preview) {
        lines.push(`- ${tag.name} (${tag.conversationCount} conversations)`)
      }
      if (sorted.length > 10) {
        lines.push(`- ... and ${sorted.length - 10} more`)
      }
      lines.push('')
    }
  }

  // Non-Standard Tags
  if (result.nonStandardTags.length > 0) {
    lines.push('## Non-Standard Tags')
    lines.push('')
    lines.push(
      'Tags not found in the standard TagRegistry mapping (may need review):'
    )
    lines.push('')
    const sorted = [...result.nonStandardTags].sort(
      (a, b) => b.conversationCount - a.conversationCount
    )
    const preview = sorted.slice(0, 20)
    lines.push('| Name | Conversations |')
    lines.push('|------|---------------|')
    for (const tag of preview) {
      lines.push(`| ${tag.name} | ${tag.conversationCount} |`)
    }
    if (sorted.length > 20) {
      lines.push('')
      lines.push(`... and ${sorted.length - 20} more`)
    }
    lines.push('')
  }

  return lines.join('\n')
}
