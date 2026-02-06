/**
 * AI-Powered Tag Consolidation Suggestions
 *
 * Uses Claude to analyze Front tags and provide intelligent suggestions for:
 * - Semantic similarity (find tags that mean the same thing)
 * - Category detection (group tags by purpose)
 * - Naming suggestions (recommend canonical names)
 * - Archive candidates (identify tags that could be retired)
 *
 * @module
 */

import type { Tag } from '@skillrecordings/front-sdk'
import { generateObject } from 'ai'
import { z } from 'zod'

// ============================================================================
// Types
// ============================================================================

export interface TagWithUsage extends Tag {
  /** Number of conversations using this tag */
  conversationCount?: number
  /** Last time the tag was used */
  lastUsedAt?: Date
}

export interface SimilarTagGroup {
  /** Tags that appear to have the same meaning */
  tags: string[]
  /** AI reasoning for why these are similar */
  reasoning: string
  /** Suggested canonical name */
  suggestedCanonical: string
  /** Confidence score 0-1 */
  confidence: number
}

export interface TagCategory {
  /** Category name (e.g., "country", "product", "issue-type") */
  name: string
  /** Tags that belong to this category */
  tags: string[]
  /** AI description of what this category represents */
  description: string
}

export interface NamingSuggestion {
  /** Current tag name */
  currentName: string
  /** Suggested improved name */
  suggestedName: string
  /** Reason for the suggestion */
  reason: string
}

export interface ArchiveCandidate {
  /** Tag name */
  tagName: string
  /** Tag ID */
  tagId: string
  /** Reason this tag could be archived */
  reason: string
  /** Confidence that this should be archived (0-1) */
  confidence: number
}

export interface TagSuggestions {
  /** Groups of similar/duplicate tags */
  similarGroups: SimilarTagGroup[]
  /** Tags organized by detected category */
  categories: TagCategory[]
  /** Naming improvements */
  namingSuggestions: NamingSuggestion[]
  /** Tags that could potentially be archived */
  archiveCandidates: ArchiveCandidate[]
  /** Summary statistics */
  summary: {
    totalTagsAnalyzed: number
    potentialDuplicates: number
    categoriesDetected: number
    archiveCandidatesCount: number
    analyzedAt: string
  }
}

// ============================================================================
// Schemas
// ============================================================================

const similarGroupSchema = z.object({
  tags: z
    .array(z.string())
    .describe('List of tag names that are semantically similar'),
  reasoning: z
    .string()
    .describe('Why these tags appear to mean the same thing'),
  suggestedCanonical: z
    .string()
    .describe('The recommended canonical name to use'),
  confidence: z.number().min(0).max(1).describe('Confidence score'),
})

const categorySchema = z.object({
  name: z.string().describe('Category identifier (lowercase, hyphenated)'),
  tags: z.array(z.string()).describe('Tags belonging to this category'),
  description: z.string().describe('What this category represents'),
})

const namingSuggestionSchema = z.object({
  currentName: z.string().describe('The current tag name'),
  suggestedName: z.string().describe('The improved name'),
  reason: z.string().describe('Why this name is better'),
})

const archiveCandidateSchema = z.object({
  tagName: z.string().describe('Name of the tag'),
  reason: z.string().describe('Why this tag could be archived'),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe('Confidence this should be archived'),
})

const analysisResultSchema = z.object({
  similarGroups: z.array(similarGroupSchema),
  categories: z.array(categorySchema),
  namingSuggestions: z.array(namingSuggestionSchema),
  archiveCandidates: z.array(archiveCandidateSchema),
})

// ============================================================================
// Prompts
// ============================================================================

const ANALYSIS_SYSTEM_PROMPT = `You are an expert at organizing and cleaning up support ticket tagging systems.

Analyze the provided list of tags from a customer support system. Your goal is to help humans clean up and consolidate their tags for better organization.

Guidelines:
- Look for tags that mean essentially the same thing (e.g., "refund" vs "refund-request" vs "refunds")
- Identify natural categories (countries, products, issue types, status indicators, etc.)
- Suggest better naming conventions (prefer lowercase, hyphenated, clear names)
- Flag tags that seem obsolete, redundant, or overly specific
- Consider usage counts when available - low-usage tags are archive candidates
- Be conservative - only suggest high-confidence consolidations

For similar groups:
- Only group tags you're confident mean the same thing
- The canonical name should be clear, consistent, and professional

For categories:
- Common categories: country, product, issue-type, status, team, priority
- A tag can only appear in one category
- Not all tags need to be categorized

For naming:
- Prefer lowercase with hyphens (kebab-case)
- Be concise but clear
- Avoid abbreviations unless universal

For archive candidates:
- Tags with very low usage
- Tags that are redundant with others
- Tags that are overly specific
- Historical tags no longer relevant`

// ============================================================================
// Analysis Functions
// ============================================================================

export interface AnalyzeTagsOptions {
  /** AI model to use */
  model?: string
  /** Tags with optional usage data */
  tags: TagWithUsage[]
  /** Include verbose reasoning */
  verbose?: boolean
}

/**
 * Analyze tags using AI to generate consolidation suggestions.
 *
 * @example
 * ```ts
 * const suggestions = await analyzeTagsWithAI({
 *   tags: [{ id: 'tag_1', name: 'refund', ... }, ...],
 *   model: 'anthropic/claude-sonnet-4'
 * })
 * console.log(suggestions.similarGroups)
 * ```
 */
export async function analyzeTagsWithAI(
  options: AnalyzeTagsOptions
): Promise<TagSuggestions> {
  const { tags, model = 'anthropic/claude-sonnet-4' } = options

  // Format tags for the prompt
  const tagList = tags
    .map((t) => {
      let line = `- ${t.name}`
      if (t.conversationCount !== undefined) {
        line += ` (usage: ${t.conversationCount})`
      }
      if (t.description) {
        line += ` - ${t.description}`
      }
      return line
    })
    .join('\n')

  const prompt = `Analyze these ${tags.length} tags from a customer support system:

${tagList}

Provide suggestions for:
1. Groups of similar/duplicate tags that could be consolidated
2. Natural categories these tags fall into
3. Tags with names that could be improved
4. Tags that are candidates for archiving

Be thorough but conservative - only suggest changes you're confident about.`

  const { object } = await generateObject({
    model,
    schema: analysisResultSchema,
    system: ANALYSIS_SYSTEM_PROMPT,
    prompt,
  })

  // Map archive candidates to include tag IDs
  const tagIdMap = new Map(tags.map((t) => [t.name.toLowerCase(), t.id]))
  const archiveCandidates: ArchiveCandidate[] = object.archiveCandidates.map(
    (c) => ({
      ...c,
      tagId: tagIdMap.get(c.tagName.toLowerCase()) || '',
    })
  )

  return {
    similarGroups: object.similarGroups,
    categories: object.categories,
    namingSuggestions: object.namingSuggestions,
    archiveCandidates,
    summary: {
      totalTagsAnalyzed: tags.length,
      potentialDuplicates: object.similarGroups.reduce(
        (acc, g) => acc + g.tags.length - 1,
        0
      ),
      categoriesDetected: object.categories.length,
      archiveCandidatesCount: object.archiveCandidates.length,
      analyzedAt: new Date().toISOString(),
    },
  }
}

// ============================================================================
// Formatting Functions
// ============================================================================

/**
 * Format suggestions as Slack blocks for human review.
 */
export function formatSuggestionsForSlack(
  suggestions: TagSuggestions
): Array<Record<string, unknown>> {
  const blocks: Array<Record<string, unknown>> = []

  // Header
  blocks.push({
    type: 'header',
    text: {
      type: 'plain_text',
      text: '🏷️ Tag Gardening Suggestions',
      emoji: true,
    },
  })

  // Summary
  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `*Summary*\n• Tags analyzed: ${suggestions.summary.totalTagsAnalyzed}\n• Potential duplicates: ${suggestions.summary.potentialDuplicates}\n• Categories detected: ${suggestions.summary.categoriesDetected}\n• Archive candidates: ${suggestions.summary.archiveCandidatesCount}`,
    },
  })

  blocks.push({ type: 'divider' })

  // Similar groups (consolidation opportunities)
  if (suggestions.similarGroups.length > 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*🔄 Consolidation Opportunities*',
      },
    })

    for (const group of suggestions.similarGroups.slice(0, 5)) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `\`${group.tags.join('` `')}\`\n→ Suggest: *${group.suggestedCanonical}*\n_${group.reasoning}_`,
        },
      })
    }

    blocks.push({ type: 'divider' })
  }

  // Archive candidates
  if (suggestions.archiveCandidates.length > 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*🗑️ Archive Candidates*',
      },
    })

    const archiveList = suggestions.archiveCandidates
      .slice(0, 10)
      .map((c) => `• \`${c.tagName}\` - ${c.reason}`)
      .join('\n')

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: archiveList,
      },
    })

    blocks.push({ type: 'divider' })
  }

  // Naming suggestions
  if (suggestions.namingSuggestions.length > 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*✏️ Naming Improvements*',
      },
    })

    const namingList = suggestions.namingSuggestions
      .slice(0, 10)
      .map(
        (s) => `• \`${s.currentName}\` → \`${s.suggestedName}\` _(${s.reason})_`
      )
      .join('\n')

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: namingList,
      },
    })
  }

  // Footer
  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `_Generated at ${suggestions.summary.analyzedAt}_`,
      },
    ],
  })

  return blocks
}

/**
 * Format suggestions as markdown for CLI output.
 */
export function formatSuggestionsAsMarkdown(
  suggestions: TagSuggestions
): string {
  const lines: string[] = []

  lines.push('# 🏷️ Tag Gardening Suggestions\n')
  lines.push(`**Analyzed at:** ${suggestions.summary.analyzedAt}\n`)
  lines.push('## Summary\n')
  lines.push(`- Tags analyzed: ${suggestions.summary.totalTagsAnalyzed}`)
  lines.push(
    `- Potential duplicates: ${suggestions.summary.potentialDuplicates}`
  )
  lines.push(`- Categories detected: ${suggestions.summary.categoriesDetected}`)
  lines.push(
    `- Archive candidates: ${suggestions.summary.archiveCandidatesCount}`
  )
  lines.push('')

  // Similar groups
  if (suggestions.similarGroups.length > 0) {
    lines.push('## 🔄 Consolidation Opportunities\n')
    for (const group of suggestions.similarGroups) {
      lines.push(`### ${group.suggestedCanonical}`)
      lines.push(
        `**Similar tags:** ${group.tags.map((t) => `\`${t}\``).join(', ')}`
      )
      lines.push(`**Reasoning:** ${group.reasoning}`)
      lines.push(`**Confidence:** ${(group.confidence * 100).toFixed(0)}%`)
      lines.push('')
    }
  }

  // Categories
  if (suggestions.categories.length > 0) {
    lines.push('## 📁 Detected Categories\n')
    for (const cat of suggestions.categories) {
      lines.push(`### ${cat.name}`)
      lines.push(`${cat.description}`)
      lines.push(`**Tags:** ${cat.tags.map((t) => `\`${t}\``).join(', ')}`)
      lines.push('')
    }
  }

  // Naming suggestions
  if (suggestions.namingSuggestions.length > 0) {
    lines.push('## ✏️ Naming Improvements\n')
    lines.push('| Current | Suggested | Reason |')
    lines.push('|---------|-----------|--------|')
    for (const s of suggestions.namingSuggestions) {
      lines.push(
        `| \`${s.currentName}\` | \`${s.suggestedName}\` | ${s.reason} |`
      )
    }
    lines.push('')
  }

  // Archive candidates
  if (suggestions.archiveCandidates.length > 0) {
    lines.push('## 🗑️ Archive Candidates\n')
    lines.push('| Tag | Reason | Confidence |')
    lines.push('|-----|--------|------------|')
    for (const c of suggestions.archiveCandidates) {
      lines.push(
        `| \`${c.tagName}\` | ${c.reason} | ${(c.confidence * 100).toFixed(0)}% |`
      )
    }
    lines.push('')
  }

  return lines.join('\n')
}

/**
 * Format suggestions as plain text for console output.
 */
export function formatSuggestionsAsText(suggestions: TagSuggestions): string {
  const lines: string[] = []

  lines.push('═══════════════════════════════════════════════════════════════')
  lines.push('                    🏷️  TAG GARDENING SUGGESTIONS')
  lines.push('═══════════════════════════════════════════════════════════════')
  lines.push('')
  lines.push(`📊 Summary`)
  lines.push(`   • Tags analyzed: ${suggestions.summary.totalTagsAnalyzed}`)
  lines.push(
    `   • Potential duplicates: ${suggestions.summary.potentialDuplicates}`
  )
  lines.push(
    `   • Categories detected: ${suggestions.summary.categoriesDetected}`
  )
  lines.push(
    `   • Archive candidates: ${suggestions.summary.archiveCandidatesCount}`
  )
  lines.push('')

  // Similar groups
  if (suggestions.similarGroups.length > 0) {
    lines.push(
      '───────────────────────────────────────────────────────────────'
    )
    lines.push('🔄 CONSOLIDATION OPPORTUNITIES')
    lines.push(
      '───────────────────────────────────────────────────────────────'
    )
    for (const group of suggestions.similarGroups) {
      lines.push('')
      lines.push(`   Similar: ${group.tags.join(' | ')}`)
      lines.push(`   → Use: "${group.suggestedCanonical}"`)
      lines.push(`   Why: ${group.reasoning}`)
      lines.push(`   Confidence: ${(group.confidence * 100).toFixed(0)}%`)
    }
    lines.push('')
  }

  // Categories
  if (suggestions.categories.length > 0) {
    lines.push(
      '───────────────────────────────────────────────────────────────'
    )
    lines.push('📁 DETECTED CATEGORIES')
    lines.push(
      '───────────────────────────────────────────────────────────────'
    )
    for (const cat of suggestions.categories) {
      lines.push('')
      lines.push(`   [${cat.name}] ${cat.description}`)
      lines.push(`   Tags: ${cat.tags.join(', ')}`)
    }
    lines.push('')
  }

  // Naming suggestions
  if (suggestions.namingSuggestions.length > 0) {
    lines.push(
      '───────────────────────────────────────────────────────────────'
    )
    lines.push('✏️  NAMING IMPROVEMENTS')
    lines.push(
      '───────────────────────────────────────────────────────────────'
    )
    for (const s of suggestions.namingSuggestions) {
      lines.push(`   "${s.currentName}" → "${s.suggestedName}" (${s.reason})`)
    }
    lines.push('')
  }

  // Archive candidates
  if (suggestions.archiveCandidates.length > 0) {
    lines.push(
      '───────────────────────────────────────────────────────────────'
    )
    lines.push('🗑️  ARCHIVE CANDIDATES')
    lines.push(
      '───────────────────────────────────────────────────────────────'
    )
    for (const c of suggestions.archiveCandidates) {
      lines.push(
        `   • ${c.tagName} - ${c.reason} (${(c.confidence * 100).toFixed(0)}%)`
      )
    }
    lines.push('')
  }

  lines.push('═══════════════════════════════════════════════════════════════')
  lines.push(`Generated: ${suggestions.summary.analyzedAt}`)
  lines.push('')

  return lines.join('\n')
}
