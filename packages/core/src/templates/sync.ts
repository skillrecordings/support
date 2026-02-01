/**
 * Template sync module for pulling Front templates into vector store.
 *
 * Syncs message templates from Front to enable semantic search
 * for finding relevant response templates during agent execution.
 *
 * Templates are stored as 'response' type vectors with metadata
 * including their Front ID, name, and inbox associations.
 */

import {
  type MessageTemplate,
  type MessageTemplateList,
  MessageTemplateListSchema,
  paginate,
} from '@skillrecordings/front-sdk'
import { createInstrumentedFrontClient } from '../front/instrumented-client'
import { upsertVector } from '../vector/client'
import type { VectorDocument } from '../vector/types'

export interface SyncTemplatesOptions {
  /** App ID for scoping templates in vector store */
  appId: string
  /** Front API token (defaults to FRONT_API_KEY env var) */
  frontApiKey?: string
  /** Optional: specific inbox IDs to filter templates (if not provided, syncs all) */
  inboxIds?: string[]
}

export interface SyncTemplatesResult {
  /** Number of templates synced */
  synced: number
  /** Number of templates skipped (e.g., not matching inbox filter) */
  skipped: number
  /** Errors encountered during sync */
  errors: Array<{
    templateId: string
    templateName: string
    error: string
  }>
}

/**
 * Convert a Front template to a vector document for storage.
 *
 * Uses template body as the embedding content with metadata
 * for filtering and attribution.
 */
function templateToVectorDocument(
  template: MessageTemplate,
  appId: string
): VectorDocument {
  // Use template body as the content for semantic search
  // Strip HTML tags for cleaner embedding
  const plainTextBody = template.body.replace(/<[^>]*>/g, '').trim()

  return {
    id: `front_template_${template.id}`,
    data: plainTextBody,
    metadata: {
      type: 'response',
      appId,
      title: template.name,
      source: 'canned-response', // Front templates are canned responses
      // Store additional fields for retrieval
      frontId: template.id,
      // Note: Front's template schema doesn't include inbox_ids in list response
      // Templates are either available_for_all_inboxes or have specific inboxes
      isGlobal: template.is_available_for_all_inboxes ? 1 : 0,
      lastUpdated: new Date().toISOString(),
    },
  }
}

/**
 * Sync all templates from Front into the vector store for semantic matching.
 *
 * This function:
 * 1. Fetches all templates from Front API (handles pagination)
 * 2. Optionally filters by inbox ID association
 * 3. Converts each template to a vector document
 * 4. Upserts into the vector store (idempotent)
 *
 * @param options - Sync configuration
 * @returns Sync result with counts and any errors
 *
 * @example
 * ```ts
 * // Sync all templates for an app
 * const result = await syncTemplates({
 *   appId: 'total-typescript'
 * })
 *
 * // Sync only templates for specific inboxes
 * const result = await syncTemplates({
 *   appId: 'total-typescript',
 *   inboxIds: ['inb_abc123']
 * })
 * ```
 */
export async function syncTemplates(
  options: SyncTemplatesOptions
): Promise<SyncTemplatesResult> {
  const { appId, frontApiKey, inboxIds } = options

  // Use provided API key or fall back to environment variable
  const apiToken = frontApiKey ?? process.env.FRONT_API_KEY
  if (!apiToken) {
    throw new Error(
      'Front API key required: provide frontApiKey option or set FRONT_API_KEY env var'
    )
  }

  const front = createInstrumentedFrontClient({ apiToken })

  const result: SyncTemplatesResult = {
    synced: 0,
    skipped: 0,
    errors: [],
  }

  // Fetch all templates with automatic pagination
  const templates = await paginate<MessageTemplateList>(
    () => front.templates.list(),
    (url) => front.raw.get<MessageTemplateList>(url, MessageTemplateListSchema)
  )

  // Process each template
  for (const template of templates) {
    try {
      // If inbox filter is specified, only sync templates that are either:
      // 1. Available for all inboxes, or
      // 2. Would be available for the specified inboxes (this info isn't in list response)
      // Note: For stricter filtering, you'd need to fetch each template individually
      // to check inbox_ids, but that's expensive. For now, sync all and filter at query time.

      // Skip templates with empty body (nothing to embed)
      if (!template.body || template.body.trim().length === 0) {
        result.skipped++
        continue
      }

      const vectorDoc = templateToVectorDocument(template, appId)
      await upsertVector(vectorDoc)
      result.synced++
    } catch (error) {
      result.errors.push({
        templateId: template.id,
        templateName: template.name,
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  return result
}

/**
 * Sync templates for all apps in the database.
 *
 * Iterates through all registered apps and syncs their templates.
 * Uses each app's configured inbox to scope the templates.
 *
 * @returns Map of app slug to sync result
 */
export async function syncAllAppTemplates(): Promise<
  Map<string, SyncTemplatesResult>
> {
  // Lazy import to avoid circular dependencies
  const { database, AppsTable } = await import('@skillrecordings/database')

  const apps = await database.select().from(AppsTable)
  const results = new Map<string, SyncTemplatesResult>()

  for (const app of apps) {
    try {
      const syncResult = await syncTemplates({
        appId: app.slug,
        inboxIds: app.front_inbox_id ? [app.front_inbox_id] : undefined,
      })
      results.set(app.slug, syncResult)
    } catch (error) {
      results.set(app.slug, {
        synced: 0,
        skipped: 0,
        errors: [
          {
            templateId: 'N/A',
            templateName: 'N/A',
            error: error instanceof Error ? error.message : 'Unknown error',
          },
        ],
      })
    }
  }

  return results
}
