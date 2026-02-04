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
import { createInstrumentedFrontClient } from '@skillrecordings/core/front/instrumented-client'
import {
  type TagWithConversationCount,
  findCaseVariants,
  findExactDuplicates,
} from '@skillrecordings/core/tags/audit'
import { DEFAULT_CATEGORY_TAG_MAPPING } from '@skillrecordings/core/tags/registry'
import type { Command } from 'commander'
import { hateoasWrap, tagListActions, tagListLinks } from './hateoas'

/**
 * Get Front SDK client from environment
 */
function getFrontSdkClient() {
  const apiToken = process.env.FRONT_API_TOKEN
  if (!apiToken) {
    throw new Error('FRONT_API_TOKEN environment variable is required')
  }
  return createInstrumentedFrontClient({ apiToken })
}

/**
 * Get Front API token
 */
function getFrontApiToken() {
  const apiToken = process.env.FRONT_API_TOKEN
  if (!apiToken) {
    throw new Error('FRONT_API_TOKEN environment variable is required')
  }
  return apiToken
}

/**
 * Raw fetch for tags - bypasses SDK validation which chokes on Front's messy data
 */
async function fetchTagsRaw(): Promise<
  Array<{
    id: string
    name: string
    highlight?: string | null
    is_private: boolean
    description?: string | null
  }>
> {
  const apiToken = getFrontApiToken()
  const allTags: Array<{
    id: string
    name: string
    highlight?: string | null
    is_private: boolean
    description?: string | null
  }> = []

  let nextUrl: string | null = 'https://api2.frontapp.com/tags'
  const front = createInstrumentedFrontClient({ apiToken })

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
async function createTagRaw(params: {
  name: string
  highlight?: string | null
  description?: string | null
}): Promise<void> {
  const apiToken = getFrontApiToken()
  const body: Record<string, unknown> = { name: params.name }
  if (params.highlight) body.highlight = params.highlight
  if (params.description) body.description = params.description

  const front = createInstrumentedFrontClient({ apiToken })
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
  front: ReturnType<typeof createInstrumentedFrontClient>,
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
  front: ReturnType<typeof createInstrumentedFrontClient>,
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
async function listTags(options: {
  json?: boolean
  unused?: boolean
}): Promise<void> {
  try {
    const front = getFrontSdkClient()
    const tags = await fetchTagsRaw()

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

    if (options.json) {
      console.log(
        JSON.stringify(
          hateoasWrap({
            type: 'tag-list',
            command: `skill front tags list${options.unused ? ' --unused' : ''} --json`,
            data: filteredTags,
            links: tagListLinks(
              filteredTags.map((t) => ({ id: t.id, name: t.name }))
            ),
            actions: tagListActions(),
          }),
          null,
          2
        )
      )
      return
    }

    if (filteredTags.length === 0) {
      if (options.unused) {
        console.log('\n✨ No unused tags found!\n')
      } else {
        console.log('\n📭 No tags found.\n')
      }
      return
    }

    const header = options.unused ? '🏷️  Unused Tags' : '🏷️  All Tags'
    console.log(`\n${header} (${filteredTags.length}):`)
    console.log('-'.repeat(80))

    // Table header
    console.log(
      `${'ID'.padEnd(20)} ${'Name'.padEnd(30)} ${'Color'.padEnd(10)} ${'Convos'.padEnd(8)}`
    )
    console.log('-'.repeat(80))

    for (const tag of filteredTags) {
      const highlight = tag.highlight || '-'
      const countStr =
        tag.conversation_count === 0 ? '0 ⚠️' : tag.conversation_count.toString()

      console.log(
        `${truncate(tag.id, 20).padEnd(20)} ${truncate(tag.name, 30).padEnd(30)} ${highlight.padEnd(10)} ${countStr.padEnd(8)}`
      )
    }

    console.log('')

    if (!options.unused) {
      const unusedCount = tagsWithCounts.filter(
        (t) => t.conversation_count === 0
      ).length
      if (unusedCount > 0) {
        console.log(
          `💡 Found ${unusedCount} unused tag(s). Use --unused to filter.\n`
        )
      }
    }
  } catch (error) {
    if (options.json) {
      console.error(
        JSON.stringify({
          error: error instanceof Error ? error.message : 'Unknown error',
        })
      )
    } else {
      console.error(
        'Error:',
        error instanceof Error ? error.message : 'Unknown error'
      )
    }
    process.exit(1)
  }
}

/**
 * Command: skill front tags delete <id>
 * Delete a tag by ID
 */
async function deleteTag(
  id: string,
  options: { force?: boolean }
): Promise<void> {
  try {
    const front = getFrontSdkClient()

    // Fetch tag details first
    const tag = await front.tags.get(id)
    const convCount = await getConversationCount(front, id)

    if (!options.force) {
      console.log(`\n🏷️  Tag: ${tag.name}`)
      console.log(`   ID: ${tag.id}`)
      console.log(`   Conversations: ${convCount}`)

      if (convCount > 0) {
        console.log(
          `\n⚠️  Warning: This tag is used in ${convCount} conversation(s).`
        )
        console.log(
          '   Deleting it will remove the tag from those conversations.'
        )
      }

      const confirmed = await confirm({
        message: `Are you sure you want to delete tag "${tag.name}"?`,
        default: false,
      })

      if (!confirmed) {
        console.log('\n❌ Cancelled.\n')
        return
      }
    }

    await front.tags.delete(id)
    console.log(`\n✅ Deleted tag "${tag.name}" (${id})\n`)
  } catch (error) {
    console.error(
      'Error:',
      error instanceof Error ? error.message : 'Unknown error'
    )
    process.exit(1)
  }
}

/**
 * Command: skill front tags rename <id> <name>
 * Rename a tag
 */
async function renameTag(id: string, newName: string): Promise<void> {
  try {
    const front = getFrontSdkClient()

    // Fetch current tag details
    const oldTag = await front.tags.get(id)
    const oldName = oldTag.name

    // Update the tag
    const updatedTag = await front.tags.update(id, { name: newName })

    console.log(`\n✅ Renamed tag:`)
    console.log(`   "${oldName}" → "${updatedTag.name}"`)
    console.log(`   ID: ${id}\n`)
  } catch (error) {
    console.error(
      'Error:',
      error instanceof Error ? error.message : 'Unknown error'
    )
    process.exit(1)
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
  front: ReturnType<typeof createInstrumentedFrontClient>,
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
function printCleanupPlan(plan: CleanupPlan): void {
  console.log('\n📋 Tag Cleanup Plan')
  console.log('='.repeat(60))

  // Duplicates to delete
  if (plan.duplicatesToDelete.length > 0) {
    console.log(
      `\n🔴 Duplicates to DELETE (${plan.duplicatesToDelete.length}):`
    )
    for (const item of plan.duplicatesToDelete) {
      console.log(
        `   - "${item.tag.name}" (${item.tag.conversationCount} convos) → ${item.reason}`
      )
    }
  }

  // Case variants to rename
  if (plan.caseVariantsToRename.length > 0) {
    console.log(
      `\n🟡 Case variants to RENAME (${plan.caseVariantsToRename.length}):`
    )
    for (const item of plan.caseVariantsToRename) {
      console.log(
        `   - "${item.tag.name}" → "${item.newName}" (merge with ${item.canonical.conversationCount} convos)`
      )
    }
  }

  // Obsolete to delete
  if (plan.obsoleteToDelete.length > 0) {
    console.log(
      `\n🗑️  Obsolete tags to DELETE (${plan.obsoleteToDelete.length}):`
    )
    for (const tag of plan.obsoleteToDelete) {
      console.log(`   - "${tag.name}" (${tag.conversationCount} convos)`)
    }
  }

  // Missing to create
  if (plan.missingToCreate.length > 0) {
    console.log(
      `\n🟢 Missing standard tags to CREATE (${plan.missingToCreate.length}):`
    )
    for (const item of plan.missingToCreate) {
      console.log(`   - "${item.name}" (${item.highlight})`)
    }
  }

  // Summary totals
  const totalChanges =
    plan.duplicatesToDelete.length +
    plan.caseVariantsToRename.length +
    plan.obsoleteToDelete.length +
    plan.missingToCreate.length

  console.log('\n' + '='.repeat(60))
  console.log(`📊 Total changes: ${totalChanges}`)
  console.log(`   - Delete duplicates: ${plan.duplicatesToDelete.length}`)
  console.log(`   - Rename variants: ${plan.caseVariantsToRename.length}`)
  console.log(`   - Delete obsolete: ${plan.obsoleteToDelete.length}`)
  console.log(`   - Create missing: ${plan.missingToCreate.length}`)

  if (totalChanges === 0) {
    console.log('\n✨ No cleanup needed - tags are in good shape!')
  }
}

/**
 * Execute cleanup plan
 */
async function executeCleanupPlan(
  front: ReturnType<typeof createInstrumentedFrontClient>,
  plan: CleanupPlan
): Promise<{ success: number; failed: number }> {
  const results = { success: 0, failed: 0 }

  // 1. Delete duplicates
  for (const item of plan.duplicatesToDelete) {
    try {
      console.log(`   Deleting duplicate "${item.tag.name}"...`)
      await front.tags.delete(item.tag.id)
      console.log(`   ✅ Deleted "${item.tag.name}"`)
      results.success++
    } catch (error) {
      console.log(
        `   ❌ Failed to delete "${item.tag.name}": ${error instanceof Error ? error.message : 'Unknown error'}`
      )
      results.failed++
    }
  }

  // 2. Rename case variants (we need to merge - can't just rename if target exists)
  for (const item of plan.caseVariantsToRename) {
    try {
      console.log(`   Renaming "${item.tag.name}" → "${item.newName}"...`)
      await front.tags.update(item.tag.id, { name: item.newName })
      console.log(`   ✅ Renamed "${item.tag.name}" → "${item.newName}"`)
      results.success++
    } catch (error) {
      // If rename fails (maybe tag with that name exists), try to delete instead
      const errMsg = error instanceof Error ? error.message : 'Unknown error'
      if (errMsg.includes('already exists') || errMsg.includes('duplicate')) {
        try {
          console.log(`   Name exists, deleting "${item.tag.name}" instead...`)
          await front.tags.delete(item.tag.id)
          console.log(`   ✅ Deleted "${item.tag.name}" (merged into existing)`)
          results.success++
        } catch (delError) {
          console.log(
            `   ❌ Failed to delete "${item.tag.name}": ${delError instanceof Error ? delError.message : 'Unknown error'}`
          )
          results.failed++
        }
      } else {
        console.log(`   ❌ Failed to rename "${item.tag.name}": ${errMsg}`)
        results.failed++
      }
    }
  }

  // 3. Delete obsolete tags
  for (const tag of plan.obsoleteToDelete) {
    try {
      console.log(`   Deleting obsolete "${tag.name}"...`)
      await front.tags.delete(tag.id)
      console.log(`   ✅ Deleted "${tag.name}"`)
      results.success++
    } catch (error) {
      console.log(
        `   ❌ Failed to delete "${tag.name}": ${error instanceof Error ? error.message : 'Unknown error'}`
      )
      results.failed++
    }
  }

  // 4. Create missing standard tags
  for (const item of plan.missingToCreate) {
    try {
      console.log(`   Creating "${item.name}"...`)
      await createTagRaw({
        name: item.name,
        highlight: item.highlight,
        description: item.description,
      })
      console.log(`   ✅ Created "${item.name}"`)
      results.success++
    } catch (error) {
      console.log(
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
async function cleanupTags(options: { execute?: boolean }): Promise<void> {
  try {
    const front = getFrontSdkClient()

    console.log('\n🔍 Analyzing tags...')

    // Fetch all tags (raw fetch to avoid SDK validation issues)
    const tags = await fetchTagsRaw()
    console.log(`   Found ${tags.length} tags`)
    console.log('   Fetching conversation counts (rate-limited)...')

    // Fetch conversation counts with rate limiting and progress
    const counts = await fetchConversationCountsRateLimited(tags, front, {
      delayMs: 150, // 150ms between batches
      batchSize: 5, // 5 concurrent requests per batch
      onProgress: (completed, total) => {
        const pct = Math.round((completed / total) * 100)
        process.stdout.write(`\r   Progress: ${completed}/${total} (${pct}%)`)
      },
    })
    console.log('') // newline after progress

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
    printCleanupPlan(plan)

    const totalChanges =
      plan.duplicatesToDelete.length +
      plan.caseVariantsToRename.length +
      plan.obsoleteToDelete.length +
      plan.missingToCreate.length

    if (totalChanges === 0) {
      console.log('')
      return
    }

    // If not executing, show dry-run notice
    if (!options.execute) {
      console.log('\n⚠️  DRY RUN - No changes made')
      console.log('   Use --execute to apply these changes\n')
      return
    }

    // Confirm before executing
    console.log('')
    const confirmed = await confirm({
      message: `Apply ${totalChanges} change(s)?`,
      default: false,
    })

    if (!confirmed) {
      console.log('\n❌ Cancelled.\n')
      return
    }

    // Execute the plan
    console.log('\n🚀 Executing cleanup...\n')
    const results = await executeCleanupPlan(front, plan)

    // Final summary
    console.log('\n' + '='.repeat(60))
    console.log('📊 Cleanup Complete')
    console.log(`   ✅ Successful: ${results.success}`)
    console.log(`   ❌ Failed: ${results.failed}`)
    console.log('')
  } catch (error) {
    console.error(
      'Error:',
      error instanceof Error ? error.message : 'Unknown error'
    )
    process.exit(1)
  }
}

/**
 * Register tag commands with Commander
 */
export function registerTagCommands(frontCommand: Command): void {
  const tags = frontCommand
    .command('tags')
    .description('List, rename, delete, and clean up Front tags')
    .addHelpText(
      'after',
      `
━━━ Tag Management ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Manage Front tags: list with usage counts, delete unused, rename,
  and bulk-clean duplicates / case variants / obsolete tags.

SUBCOMMANDS
  list      List all tags with conversation counts (--unused, --json)
  delete    Delete a tag by ID (tag_xxx)
  rename    Rename a tag (tag_xxx → new name)
  cleanup   Find and fix duplicate, case-variant, and obsolete tags

EXAMPLES
  skill front tags list
  skill front tags list --unused --json
  skill front tags delete tag_abc123 --force
  skill front tags rename tag_abc123 "billing-issue"
  skill front tags cleanup
  skill front tags cleanup --execute

RELATED COMMANDS
  skill front tag <cnv_xxx> <tag_xxx>       Apply a tag to a conversation
  skill front untag <cnv_xxx> <tag_xxx>     Remove a tag from a conversation
`
    )

  tags
    .command('list')
    .description('List all tags with conversation counts')
    .option('--json', 'Output as JSON')
    .option('--unused', 'Show only tags with 0 conversations')
    .addHelpText(
      'after',
      `
━━━ Tag List ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Lists every tag in the Front workspace with its conversation count.
  Conversation counts are fetched per-tag (rate-limited, ~5 concurrent).

OPTIONS
  --unused    Show only tags with 0 conversations (candidates for deletion)
  --json      Output as JSON (HATEOAS-wrapped with links and actions)

OUTPUT COLUMNS (table mode)
  ID          Tag ID (tag_xxx)
  Name        Tag display name
  Color       Highlight color
  Convos      Number of conversations using this tag (0 shows warning)

JSON + jq PATTERNS
  # All unused tags
  skill front tags list --json | jq '.data[] | select(.conversation_count == 0)'

  # Tag names only
  skill front tags list --json | jq '.data[].name'

  # Tags sorted by usage (most → least)
  skill front tags list --json | jq '.data | sort_by(-.conversation_count)'

  # Count of unused tags
  skill front tags list --json | jq '[.data[] | select(.conversation_count == 0)] | length'

NOTE
  Fetching counts for many tags can take a while due to Front API rate limits.
  The command batches requests (5 at a time, 100ms between batches).
`
    )
    .action(listTags)

  tags
    .command('delete')
    .description('Delete a tag by ID')
    .argument('<id>', 'Tag ID (e.g., tag_xxx)')
    .option('-f, --force', 'Skip confirmation prompt')
    .addHelpText(
      'after',
      `
━━━ Tag Delete ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Delete a single tag by its Front ID.

ARGUMENTS
  <id>    Tag ID in tag_xxx format (find IDs via: skill front tags list --json)

OPTIONS
  -f, --force    Skip the confirmation prompt (use in scripts)

BEHAVIOR
  - Shows tag name, ID, and conversation count before prompting
  - Warns if the tag is still applied to conversations
  - Deleting a tag removes it from all conversations that use it
  - This action is irreversible

EXAMPLES
  skill front tags delete tag_abc123
  skill front tags delete tag_abc123 --force
`
    )
    .action(deleteTag)

  tags
    .command('rename')
    .description('Rename a tag')
    .argument('<id>', 'Tag ID (e.g., tag_xxx)')
    .argument('<name>', 'New tag name')
    .addHelpText(
      'after',
      `
━━━ Tag Rename ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Rename a tag. The tag keeps its ID and stays applied to all conversations.

ARGUMENTS
  <id>      Tag ID in tag_xxx format
  <name>    New display name for the tag

EXAMPLES
  skill front tags rename tag_abc123 "billing-issue"
  skill front tags rename tag_abc123 "refund-request"

NOTE
  If a tag with the new name already exists, the API will return an error.
  Use "skill front tags cleanup" to merge duplicates and case variants.
`
    )
    .action(renameTag)

  tags
    .command('cleanup')
    .description(
      'Clean up tags: delete duplicates, merge case variants, remove obsolete, create missing standard tags'
    )
    .option('--execute', 'Actually apply changes (default is dry-run)', false)
    .addHelpText(
      'after',
      `
━━━ Tag Cleanup ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Analyze all tags for issues and optionally fix them. Default is dry-run.

WHAT IT FINDS
  - Exact duplicates (same name, multiple tag IDs)
  - Case variants ("Refund" vs "refund" vs "REFUND")
  - Obsolete tags (date-based like "jan-2022", Gmail imports like "INBOX")
  - Missing standard tags from the category registry

WHAT IT DOES (with --execute)
  - Deletes duplicate tags (keeps the one with most conversations)
  - Renames case variants to canonical lowercase-hyphenated form
  - Deletes obsolete/imported tags
  - Creates missing standard category tags

OPTIONS
  --execute    Apply the cleanup plan. Without this flag, only a dry-run
               report is printed (safe to run anytime).

EXAMPLES
  # See what would be changed (safe, read-only)
  skill front tags cleanup

  # Actually apply changes (prompts for confirmation)
  skill front tags cleanup --execute
`
    )
    .action(cleanupTags)
}
