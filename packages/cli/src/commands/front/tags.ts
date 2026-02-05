/**
 * Front CLI tag management commands
 *
 * Provides commands for:
 * - Listing tags with conversation counts
 * - Filtering unused tags
 * - Deleting tags
 * - Renaming tags
 * - Cleanup (duplicates, case variants, obsolete tags)
 */

import { confirm } from '@inquirer/prompts'
import {
  type TagWithConversationCount,
  findCaseVariants,
  findExactDuplicates,
} from '@skillrecordings/core/tags/audit'
import { DEFAULT_CATEGORY_TAG_MAPPING } from '@skillrecordings/core/tags/registry'
import type { Command } from 'commander'
import { type CommandContext, createContext } from '../../core/context'
import { CLIError, formatError } from '../../core/errors'
import { isListOutputFormat, outputList } from '../../core/list-output'
import { getFrontClient } from './client'
import { hateoasWrap, tagListActions, tagListLinks } from './hateoas'

/**
 * Get Front SDK client from environment
 */
function getFrontSdkClient(ctx: CommandContext) {
  return getFrontClient(ctx)
}

/**
 * Raw fetch for tags - bypasses SDK validation which chokes on Front's messy data
 */
async function fetchTagsRaw(front: ReturnType<typeof getFrontClient>): Promise<
  Array<{
    id: string
    name: string
    highlight?: string | null
    is_private: boolean
    description?: string | null
  }>
> {
  const allTags: Array<{
    id: string
    name: string
    highlight?: string | null
    is_private: boolean
    description?: string | null
  }> = []

  let nextUrl: string | null = 'https://api2.frontapp.com/tags'
  while (nextUrl) {
    const data = (await front.raw.get(nextUrl)) as {
      _results: Array<{
        id: string
        name: string
        highlight?: string | null
        is_private: boolean
        description?: string | null
      }>
      _pagination?: { next?: string }
    }

    allTags.push(...data._results)
    nextUrl = data._pagination?.next ?? null
  }

  return allTags
}

/**
 * Raw create tag - bypasses SDK response validation
 */
async function createTagRaw(
  front: ReturnType<typeof getFrontClient>,
  params: {
    name: string
    highlight?: string | null
    description?: string | null
  }
): Promise<void> {
  const body: Record<string, unknown> = { name: params.name }
  if (params.highlight) body.highlight = params.highlight
  if (params.description) body.description = params.description

  await front.raw.post('/tags', body)
}

/**
 * Truncate string with ellipsis
 */
function truncate(str: string, len: number): string {
  if (str.length <= len) return str
  return str.slice(0, len - 3) + '...'
}

interface TagWithCount {
  id: string
  name: string
  highlight: string | null
  is_private: boolean
  description: string | null
  conversation_count: number
}

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Get conversation count for a tag
 * Uses the conversations endpoint and checks pagination
 */
async function getConversationCount(
  front: ReturnType<typeof getFrontClient>,
  tagId: string
): Promise<number> {
  try {
    const result = (await front.tags.listConversations(tagId)) as {
      _results?: unknown[]
      _pagination?: { total?: number }
    }
    // Use pagination total if available, otherwise count results
    return result._pagination?.total ?? result._results?.length ?? 0
  } catch {
    return 0
  }
}

/**
 * Fetch conversation counts for tags with rate limiting
 * @param tags - Array of tags to fetch counts for
 * @param front - Front SDK client
 * @param delayMs - Delay between API calls (default 100ms)
 * @param batchSize - Number of concurrent requests (default 5)
 * @param onProgress - Callback for progress updates
 */
async function fetchConversationCountsRateLimited<
  T extends { id: string; name: string },
>(
  tags: T[],
  front: ReturnType<typeof getFrontClient>,
  options: {
    delayMs?: number
    batchSize?: number
    onProgress?: (completed: number, total: number) => void
  } = {}
): Promise<Map<string, number>> {
  const { delayMs = 100, batchSize = 5, onProgress } = options
  const counts = new Map<string, number>()

  // Process in batches
  for (let i = 0; i < tags.length; i += batchSize) {
    const batch = tags.slice(i, i + batchSize)

    // Fetch batch concurrently
    const results = await Promise.all(
      batch.map(async (tag) => {
        const count = await getConversationCount(front, tag.id)
        return { id: tag.id, count }
      })
    )

    // Store results
    for (const { id, count } of results) {
      counts.set(id, count)
    }

    // Progress update
    const completed = Math.min(i + batchSize, tags.length)
    onProgress?.(completed, tags.length)

    // Rate limit delay between batches (not after last batch)
    if (i + batchSize < tags.length) {
      await sleep(delayMs)
    }
  }

  return counts
}

/**
 * Command: skill front tags list
 * List all tags with conversation counts
 */
export async function listTags(
  ctx: CommandContext,
  options: {
    json?: boolean
    unused?: boolean
    idsOnly?: boolean
    outputFormat?: string
  }
): Promise<void> {
  const outputFormat = isListOutputFormat(options.outputFormat)
    ? options.outputFormat
    : undefined
  if (options.outputFormat && !outputFormat) {
    throw new CLIError({
      userMessage: 'Invalid --output-format value.',
      suggestion: 'Use json, ndjson, or csv.',
    })
  }
  const outputJson =
    options.json === true || ctx.format === 'json' || outputFormat === 'json'
  const idsOnly = options.idsOnly === true

  try {
    const front = getFrontSdkClient(ctx)
    const tags = await fetchTagsRaw(front)

    // Fetch conversation counts for each tag
    const tagsWithCounts: TagWithCount[] = await Promise.all(
      tags.map(async (tag) => {
        const count = await getConversationCount(front, tag.id)
        return {
          id: tag.id,
          name: tag.name,
          highlight: tag.highlight ?? null,
          is_private: tag.is_private,
          description: tag.description ?? null,
          conversation_count: count,
        }
      })
    )

    // Filter to unused if requested
    const filteredTags = options.unused
      ? tagsWithCounts.filter((t) => t.conversation_count === 0)
      : tagsWithCounts

    if (idsOnly) {
      for (const tag of filteredTags) {
        ctx.output.data(tag.id)
      }
      return
    }

    if (outputFormat && outputFormat !== 'json') {
      const rows = filteredTags.map((tag) => ({
        ...tag,
        _actions: tagListActions(),
      }))
      outputList(ctx, rows, outputFormat)
      return
    }

    if (outputJson) {
      ctx.output.data(
        hateoasWrap({
          type: 'tag-list',
          command: `skill front tags list${options.unused ? ' --unused' : ''} --json`,
          data: filteredTags,
          links: tagListLinks(
            filteredTags.map((t) => ({ id: t.id, name: t.name }))
          ),
          actions: tagListActions(),
        })
      )
      return
    }

    if (filteredTags.length === 0) {
      if (options.unused) {
        ctx.output.data('\n✨ No unused tags found!\n')
      } else {
        ctx.output.data('\n📭 No tags found.\n')
      }
      return
    }

    const header = options.unused ? '🏷️  Unused Tags' : '🏷️  All Tags'
    ctx.output.data(`\n${header} (${filteredTags.length}):`)
    ctx.output.data('-'.repeat(80))

    // Table header
    ctx.output.data(
      `${'ID'.padEnd(20)} ${'Name'.padEnd(30)} ${'Color'.padEnd(10)} ${'Convos'.padEnd(8)}`
    )
    ctx.output.data('-'.repeat(80))

    for (const tag of filteredTags) {
      const highlight = tag.highlight || '-'
      const countStr =
        tag.conversation_count === 0 ? '0 ⚠️' : tag.conversation_count.toString()

      ctx.output.data(
        `${truncate(tag.id, 20).padEnd(20)} ${truncate(tag.name, 30).padEnd(30)} ${highlight.padEnd(10)} ${countStr.padEnd(8)}`
      )
    }

    ctx.output.data('')

    if (!options.unused) {
      const unusedCount = tagsWithCounts.filter(
        (t) => t.conversation_count === 0
      ).length
      if (unusedCount > 0) {
        ctx.output.data(
          `💡 Found ${unusedCount} unused tag(s). Use --unused to filter.\n`
        )
      }
    }
  } catch (error) {
    const cliError =
      error instanceof CLIError
        ? error
        : new CLIError({
            userMessage: 'Failed to list Front tags.',
            suggestion: 'Verify FRONT_API_TOKEN.',
            cause: error,
          })
    ctx.output.error(formatError(cliError))
    process.exitCode = cliError.exitCode
  }
}

/**
 * Command: skill front tags delete <id>
 * Delete a tag by ID
 */
export async function deleteTag(
  ctx: CommandContext,
  id: string,
  options: { force?: boolean; dryRun?: boolean }
): Promise<void> {
  try {
    const front = getFrontSdkClient(ctx)

    // Fetch tag details first
    const tag = await front.tags.get(id)
    const convCount = await getConversationCount(front, id)

    if (options.dryRun) {
      ctx.output.data(
        `\n🧪 DRY RUN: Would delete tag "${tag.name}" (${tag.id})`
      )
      ctx.output.data(`   Conversations: ${convCount}`)
      ctx.output.data('')
      return
    }

    if (!options.force) {
      ctx.output.data(`\n🏷️  Tag: ${tag.name}`)
      ctx.output.data(`   ID: ${tag.id}`)
      ctx.output.data(`   Conversations: ${convCount}`)

      if (convCount > 0) {
        ctx.output.data(
          `\n⚠️  Warning: This tag is used in ${convCount} conversation(s).`
        )
        ctx.output.data(
          '   Deleting it will remove the tag from those conversations.'
        )
      }

      const confirmed = await confirm({
        message: `Are you sure you want to delete tag "${tag.name}"?`,
        default: false,
      })

      if (!confirmed) {
        ctx.output.data('\n❌ Cancelled.\n')
        return
      }
    }

    await front.tags.delete(id)
    ctx.output.data(`\n✅ Deleted tag "${tag.name}" (${id})\n`)
  } catch (error) {
    const cliError =
      error instanceof CLIError
        ? error
        : new CLIError({
            userMessage: 'Failed to delete Front tag.',
            suggestion: 'Verify tag ID and FRONT_API_TOKEN.',
            cause: error,
          })
    ctx.output.error(formatError(cliError))
    process.exitCode = cliError.exitCode
  }
}

/**
 * Command: skill front tags rename <id> <name>
 * Rename a tag
 */
export async function renameTag(
  ctx: CommandContext,
  id: string,
  newName: string,
  options: { dryRun?: boolean }
): Promise<void> {
  try {
    const front = getFrontSdkClient(ctx)

    // Fetch current tag details
    const oldTag = await front.tags.get(id)
    const oldName = oldTag.name

    if (options.dryRun) {
      ctx.output.data(`\n🧪 DRY RUN: Would rename tag:`)
      ctx.output.data(`   "${oldName}" → "${newName}"`)
      ctx.output.data(`   ID: ${id}\n`)
      return
    }

    // Update the tag
    const updatedTag = await front.tags.update(id, { name: newName })

    ctx.output.data(`\n✅ Renamed tag:`)
    ctx.output.data(`   "${oldName}" → "${updatedTag.name}"`)
    ctx.output.data(`   ID: ${id}\n`)
  } catch (error) {
    const cliError =
      error instanceof CLIError
        ? error
        : new CLIError({
            userMessage: 'Failed to rename Front tag.',
            suggestion: 'Verify tag ID, new name, and FRONT_API_TOKEN.',
            cause: error,
          })
    ctx.output.error(formatError(cliError))
    process.exitCode = cliError.exitCode
  }
}

// ============================================================================
// Cleanup Command
// ============================================================================

/**
 * Patterns for obsolete tags that should be deleted
 */
const OBSOLETE_TAG_PATTERNS = [
  /^giftmas$/i,
  /^jan-2022$/i,
  /^feb-2022$/i,
  /^mar-2022$/i,
  /^apr-2022$/i,
  /^may-2022$/i,
  /^jun-2022$/i,
  /^jul-2022$/i,
  /^aug-2022$/i,
  /^sep-2022$/i,
  /^oct-2022$/i,
  /^nov-2022$/i,
  /^dec-2022$/i,
  // Gmail import artifacts (e.g., "INBOX", "STARRED", etc.)
  /^INBOX$/,
  /^STARRED$/,
  /^IMPORTANT$/,
  /^SENT$/,
  /^DRAFT$/,
  /^CATEGORY_/,
  /^UNREAD$/,
]

/**
 * Convert name to canonical lowercase-hyphenated form
 */
function toCanonicalForm(name: string): string {
  return name
    .toLowerCase()
    .replace(/[_\s]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

/**
 * Check if tag name matches obsolete patterns
 */
function isObsoleteTag(name: string): boolean {
  return OBSOLETE_TAG_PATTERNS.some((pattern) => pattern.test(name))
}

interface CleanupPlan {
  duplicatesToDelete: Array<{
    tag: TagWithConversationCount
    keepTag: TagWithConversationCount
    reason: string
  }>
  caseVariantsToRename: Array<{
    tag: TagWithConversationCount
    newName: string
    canonical: TagWithConversationCount
  }>
  obsoleteToDelete: TagWithConversationCount[]
  missingToCreate: Array<{
    name: string
    highlight: string
    description: string
  }>
}

/**
 * Build cleanup plan from current tags
 */
async function buildCleanupPlan(
  front: ReturnType<typeof getFrontClient>,
  tagsWithCounts: TagWithConversationCount[]
): Promise<CleanupPlan> {
  const plan: CleanupPlan = {
    duplicatesToDelete: [],
    caseVariantsToRename: [],
    obsoleteToDelete: [],
    missingToCreate: [],
  }

  // 1. Find exact duplicates
  const exactDuplicates = findExactDuplicates(tagsWithCounts)
  for (const group of exactDuplicates) {
    // Sort by conversation count descending - keep the one with most conversations
    const sorted = [...group.tags].sort(
      (a, b) => b.conversationCount - a.conversationCount
    )
    const keep = sorted[0]!
    for (const tag of sorted.slice(1)) {
      plan.duplicatesToDelete.push({
        tag,
        keepTag: keep,
        reason: `Exact duplicate of "${keep.name}" (keeping ${keep.conversationCount} convos)`,
      })
    }
  }

  // 2. Find case variants (but exclude tags already marked for deletion)
  const tagsToDeleteIds = new Set(plan.duplicatesToDelete.map((d) => d.tag.id))
  const remainingTags = tagsWithCounts.filter((t) => !tagsToDeleteIds.has(t.id))
  const caseVariants = findCaseVariants(remainingTags)

  for (const group of caseVariants) {
    // Sort by conversation count descending
    const sorted = [...group.variants].sort(
      (a, b) => b.conversationCount - a.conversationCount
    )
    const canonical = sorted[0]!
    const canonicalForm = toCanonicalForm(canonical.name)

    for (const variant of sorted.slice(1)) {
      // Don't rename if already in canonical form
      if (variant.name === canonicalForm) continue

      plan.caseVariantsToRename.push({
        tag: variant,
        newName: canonicalForm,
        canonical,
      })
    }

    // If the "canonical" tag (most convos) isn't in canonical form, rename it too
    if (canonical.name !== canonicalForm) {
      // Check if there's already a tag with the canonical form
      const existingCanonical = sorted.find((t) => t.name === canonicalForm)
      if (!existingCanonical) {
        plan.caseVariantsToRename.push({
          tag: canonical,
          newName: canonicalForm,
          canonical,
        })
      }
    }
  }

  // 3. Find obsolete tags
  for (const tag of tagsWithCounts) {
    if (isObsoleteTag(tag.name) && !tagsToDeleteIds.has(tag.id)) {
      plan.obsoleteToDelete.push(tag)
    }
  }

  // 4. Find missing standard tags
  const existingTagNames = new Set(
    tagsWithCounts.map((t) => t.name.toLowerCase())
  )
  const categoryConfigs = Object.values(DEFAULT_CATEGORY_TAG_MAPPING)
  for (const config of categoryConfigs) {
    if (!existingTagNames.has(config.tagName.toLowerCase())) {
      plan.missingToCreate.push({
        name: config.tagName,
        highlight: config.highlight,
        description: config.description ?? '',
      })
    }
  }

  return plan
}

/**
 * Print cleanup plan summary
 */
function printCleanupPlan(ctx: CommandContext, plan: CleanupPlan): void {
  ctx.output.data('\n📋 Tag Cleanup Plan')
  ctx.output.data('='.repeat(60))

  // Duplicates to delete
  if (plan.duplicatesToDelete.length > 0) {
    ctx.output.data(
      `\n🔴 Duplicates to DELETE (${plan.duplicatesToDelete.length}):`
    )
    for (const item of plan.duplicatesToDelete) {
      ctx.output.data(
        `   - "${item.tag.name}" (${item.tag.conversationCount} convos) → ${item.reason}`
      )
    }
  }

  // Case variants to rename
  if (plan.caseVariantsToRename.length > 0) {
    ctx.output.data(
      `\n🟡 Case variants to RENAME (${plan.caseVariantsToRename.length}):`
    )
    for (const item of plan.caseVariantsToRename) {
      ctx.output.data(
        `   - "${item.tag.name}" → "${item.newName}" (merge with ${item.canonical.conversationCount} convos)`
      )
    }
  }

  // Obsolete to delete
  if (plan.obsoleteToDelete.length > 0) {
    ctx.output.data(
      `\n🗑️  Obsolete tags to DELETE (${plan.obsoleteToDelete.length}):`
    )
    for (const tag of plan.obsoleteToDelete) {
      ctx.output.data(`   - "${tag.name}" (${tag.conversationCount} convos)`)
    }
  }

  // Missing to create
  if (plan.missingToCreate.length > 0) {
    ctx.output.data(
      `\n🟢 Missing standard tags to CREATE (${plan.missingToCreate.length}):`
    )
    for (const item of plan.missingToCreate) {
      ctx.output.data(`   - "${item.name}" (${item.highlight})`)
    }
  }

  // Summary totals
  const totalChanges =
    plan.duplicatesToDelete.length +
    plan.caseVariantsToRename.length +
    plan.obsoleteToDelete.length +
    plan.missingToCreate.length

  ctx.output.data('\n' + '='.repeat(60))
  ctx.output.data(`📊 Total changes: ${totalChanges}`)
  ctx.output.data(`   - Delete duplicates: ${plan.duplicatesToDelete.length}`)
  ctx.output.data(`   - Rename variants: ${plan.caseVariantsToRename.length}`)
  ctx.output.data(`   - Delete obsolete: ${plan.obsoleteToDelete.length}`)
  ctx.output.data(`   - Create missing: ${plan.missingToCreate.length}`)

  if (totalChanges === 0) {
    ctx.output.data('\n✨ No cleanup needed - tags are in good shape!')
  }
}

/**
 * Execute cleanup plan
 */
async function executeCleanupPlan(
  ctx: CommandContext,
  front: ReturnType<typeof getFrontClient>,
  plan: CleanupPlan
): Promise<{ success: number; failed: number }> {
  const results = { success: 0, failed: 0 }

  // 1. Delete duplicates
  for (const item of plan.duplicatesToDelete) {
    try {
      ctx.output.data(`   Deleting duplicate "${item.tag.name}"...`)
      await front.tags.delete(item.tag.id)
      ctx.output.data(`   ✅ Deleted "${item.tag.name}"`)
      results.success++
    } catch (error) {
      ctx.output.data(
        `   ❌ Failed to delete "${item.tag.name}": ${error instanceof Error ? error.message : 'Unknown error'}`
      )
      results.failed++
    }
  }

  // 2. Rename case variants (we need to merge - can't just rename if target exists)
  for (const item of plan.caseVariantsToRename) {
    try {
      ctx.output.data(`   Renaming "${item.tag.name}" → "${item.newName}"...`)
      await front.tags.update(item.tag.id, { name: item.newName })
      ctx.output.data(`   ✅ Renamed "${item.tag.name}" → "${item.newName}"`)
      results.success++
    } catch (error) {
      // If rename fails (maybe tag with that name exists), try to delete instead
      const errMsg = error instanceof Error ? error.message : 'Unknown error'
      if (errMsg.includes('already exists') || errMsg.includes('duplicate')) {
        try {
          ctx.output.data(
            `   Name exists, deleting "${item.tag.name}" instead...`
          )
          await front.tags.delete(item.tag.id)
          ctx.output.data(
            `   ✅ Deleted "${item.tag.name}" (merged into existing)`
          )
          results.success++
        } catch (delError) {
          ctx.output.data(
            `   ❌ Failed to delete "${item.tag.name}": ${delError instanceof Error ? delError.message : 'Unknown error'}`
          )
          results.failed++
        }
      } else {
        ctx.output.data(`   ❌ Failed to rename "${item.tag.name}": ${errMsg}`)
        results.failed++
      }
    }
  }

  // 3. Delete obsolete tags
  for (const tag of plan.obsoleteToDelete) {
    try {
      ctx.output.data(`   Deleting obsolete "${tag.name}"...`)
      await front.tags.delete(tag.id)
      ctx.output.data(`   ✅ Deleted "${tag.name}"`)
      results.success++
    } catch (error) {
      ctx.output.data(
        `   ❌ Failed to delete "${tag.name}": ${error instanceof Error ? error.message : 'Unknown error'}`
      )
      results.failed++
    }
  }

  // 4. Create missing standard tags
  for (const item of plan.missingToCreate) {
    try {
      ctx.output.data(`   Creating "${item.name}"...`)
      await createTagRaw(front, {
        name: item.name,
        highlight: item.highlight,
        description: item.description,
      })
      ctx.output.data(`   ✅ Created "${item.name}"`)
      results.success++
    } catch (error) {
      ctx.output.data(
        `   ❌ Failed to create "${item.name}": ${error instanceof Error ? error.message : 'Unknown error'}`
      )
      results.failed++
    }
  }

  return results
}

/**
 * Command: skill front tags cleanup
 * Clean up tag issues: duplicates, case variants, obsolete tags
 */
export async function cleanupTags(
  ctx: CommandContext,
  options: { execute?: boolean }
): Promise<void> {
  try {
    const front = getFrontSdkClient(ctx)

    ctx.output.data('\n🔍 Analyzing tags...')

    // Fetch all tags (raw fetch to avoid SDK validation issues)
    const tags = await fetchTagsRaw(front)
    ctx.output.data(`   Found ${tags.length} tags`)
    ctx.output.data('   Fetching conversation counts (rate-limited)...')

    // Fetch conversation counts with rate limiting and progress
    const counts = await fetchConversationCountsRateLimited(tags, front, {
      delayMs: 150, // 150ms between batches
      batchSize: 5, // 5 concurrent requests per batch
      onProgress: (completed, total) => {
        const pct = Math.round((completed / total) * 100)
        ctx.output.progress(
          `Progress: ${completed}/${total} (${pct}%) for tag analysis`
        )
      },
    })
    ctx.output.data('') // newline after progress

    // Build tag objects with counts
    const tagsWithCounts: TagWithConversationCount[] = tags.map((tag) => ({
      id: tag.id,
      name: tag.name,
      highlight: tag.highlight ?? null,
      is_private: tag.is_private,
      description: tag.description ?? null,
      conversationCount: counts.get(tag.id) ?? 0,
      _links: {
        self: '',
        related: { owner: '', children: '', conversations: '' },
      },
    })) as unknown as TagWithConversationCount[]

    // Build cleanup plan
    const plan = await buildCleanupPlan(front, tagsWithCounts)

    // Print the plan
    printCleanupPlan(ctx, plan)

    const totalChanges =
      plan.duplicatesToDelete.length +
      plan.caseVariantsToRename.length +
      plan.obsoleteToDelete.length +
      plan.missingToCreate.length

    if (totalChanges === 0) {
      ctx.output.data('')
      return
    }

    // If not executing, show dry-run notice
    if (!options.execute) {
      ctx.output.data('\n⚠️  DRY RUN - No changes made')
      ctx.output.data('   Use --execute to apply these changes\n')
      return
    }

    // Confirm before executing
    ctx.output.data('')
    const confirmed = await confirm({
      message: `Apply ${totalChanges} change(s)?`,
      default: false,
    })

    if (!confirmed) {
      ctx.output.data('\n❌ Cancelled.\n')
      return
    }

    // Execute the plan
    ctx.output.data('\n🚀 Executing cleanup...\n')
    const results = await executeCleanupPlan(ctx, front, plan)

    // Final summary
    ctx.output.data('\n' + '='.repeat(60))
    ctx.output.data('📊 Cleanup Complete')
    ctx.output.data(`   ✅ Successful: ${results.success}`)
    ctx.output.data(`   ❌ Failed: ${results.failed}`)
    ctx.output.data('')
  } catch (error) {
    const cliError =
      error instanceof CLIError
        ? error
        : new CLIError({
            userMessage: 'Failed to clean up Front tags.',
            suggestion: 'Verify FRONT_API_TOKEN and tag permissions.',
            cause: error,
          })
    ctx.output.error(formatError(cliError))
    process.exitCode = cliError.exitCode
  }
}

/**
 * Register tag commands with Commander
 */
export function registerTagCommands(frontCommand: Command): void {
  const tags = frontCommand
    .command('tags')
    .description('List, rename, delete, and clean up Front tags')

  tags
    .command('list')
    .description('List all tags with conversation counts')
    .option('--json', 'Output as JSON')
    .option('--unused', 'Show only tags with 0 conversations')
    .option('--ids-only', 'Output only IDs (one per line)')
    .option(
      '--output-format <format>',
      'Output format for lists (json|ndjson|csv)'
    )
    .action(
      async (
        options: {
          json?: boolean
          unused?: boolean
          idsOnly?: boolean
          outputFormat?: string
        },
        command
      ) => {
        const opts =
          typeof command.optsWithGlobals === 'function'
            ? command.optsWithGlobals()
            : {
                ...command.parent?.opts(),
                ...command.opts(),
              }
        const ctx = await createContext({
          format:
            options.json || options.outputFormat === 'json'
              ? 'json'
              : opts.format,
          verbose: opts.verbose,
          quiet: opts.quiet,
        })
        await listTags(ctx, options)
      }
    )

  tags
    .command('delete')
    .description('Delete a tag by ID')
    .argument('<id>', 'Tag ID (e.g., tag_xxx)')
    .option('-f, --force', 'Skip confirmation prompt')
    .option('--dry-run', 'Preview without deleting')
    .action(
      async (
        id: string,
        options: { force?: boolean; dryRun?: boolean },
        command
      ) => {
        const opts =
          typeof command.optsWithGlobals === 'function'
            ? command.optsWithGlobals()
            : {
                ...command.parent?.opts(),
                ...command.opts(),
              }
        const ctx = await createContext({
          format: opts.format,
          verbose: opts.verbose,
          quiet: opts.quiet,
        })
        await deleteTag(ctx, id, options)
      }
    )

  tags
    .command('rename')
    .description('Rename a tag')
    .argument('<id>', 'Tag ID (e.g., tag_xxx)')
    .argument('<name>', 'New tag name')
    .option('--dry-run', 'Preview without renaming')
    .action(async (id: string, name: string, options, command) => {
      const opts =
        typeof command.optsWithGlobals === 'function'
          ? command.optsWithGlobals()
          : {
              ...command.parent?.opts(),
              ...command.opts(),
            }
      const ctx = await createContext({
        format: opts.format,
        verbose: opts.verbose,
        quiet: opts.quiet,
      })
      await renameTag(ctx, id, name, options)
    })

  tags
    .command('cleanup')
    .description(
      'Clean up tags: delete duplicates, merge case variants, remove obsolete, create missing standard tags'
    )
    .option('--execute', 'Actually apply changes (default is dry-run)', false)
    .action(async (options: { execute?: boolean }, command) => {
      const opts =
        typeof command.optsWithGlobals === 'function'
          ? command.optsWithGlobals()
          : {
              ...command.parent?.opts(),
              ...command.opts(),
            }
      const ctx = await createContext({
        format: opts.format,
        verbose: opts.verbose,
        quiet: opts.quiet,
      })
      await cleanupTags(ctx, options)
    })
}
