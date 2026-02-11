/**
 * Retention policies and cleanup service
 *
 * Hard-deletes records older than the configured retention period.
 * Runs as an Inngest cron workflow daily at 3am.
 */

import type { Database } from '@skillrecordings/database'
import {
  AuditLogTable,
  ConversationsTable,
  WebhookPayloadSnapshotsTable,
} from '@skillrecordings/database'
import { lt, sql } from 'drizzle-orm'

export const RETENTION_DEFAULTS = {
  conversations: 90, // days
  vectors: 180,
  auditLogs: 365,
  webhookPayloads: 7,
} as const

export interface CleanupReport {
  conversationsDeleted: number
  vectorsDeleted: number
  auditLogsDeleted: number
  webhookPayloadsDeleted: number
  timestamp: string
}

const VECTOR_RANGE_PAGE_SIZE = 1000
type VectorRangePage = {
  vectors?: Array<{ id: string | number; metadata?: Record<string, unknown> }>
  nextCursor?: string | number | null
}

function parseMetadataTimestamp(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    // Treat low values as seconds and convert to milliseconds.
    return value < 1_000_000_000_000 ? value * 1000 : value
  }

  if (typeof value !== 'string') return null

  const dateValue = Date.parse(value)
  if (Number.isNaN(dateValue)) return null

  return dateValue
}

function isVectorExpired(vector: any, cutoffMs: number): boolean {
  const metadata = vector?.metadata
  if (!metadata || typeof metadata !== 'object') return false

  const timestampCandidates = [
    metadata.createdAtMs,
    metadata.createdAtUnix,
    metadata.created_at,
    metadata.createdAt,
    metadata.resolvedAt,
    metadata.lastUpdated,
  ]

  for (const candidate of timestampCandidates) {
    const parsed = parseMetadataTimestamp(candidate)
    if (parsed !== null) {
      return parsed < cutoffMs
    }
  }

  return false
}

/**
 * Clean up expired data according to retention policies.
 *
 * Process:
 * 1. Hard delete conversations older than retention period
 * 2. Delete expired vectors from vector index
 * 3. Hard delete audit logs older than retention period
 * 4. Hard delete webhook payload snapshots older than retention period
 *
 * @param db - Drizzle database instance
 * @param vectorIndex - Vector index client
 * @returns Cleanup report with counts
 */
export async function cleanupExpiredData(
  db: Database,
  vectorIndex: any
): Promise<CleanupReport> {
  const report: CleanupReport = {
    conversationsDeleted: 0,
    vectorsDeleted: 0,
    auditLogsDeleted: 0,
    webhookPayloadsDeleted: 0,
    timestamp: new Date().toISOString(),
  }

  const now = new Date()

  // Calculate cutoff dates
  const conversationCutoff = new Date(now)
  conversationCutoff.setDate(
    conversationCutoff.getDate() - RETENTION_DEFAULTS.conversations
  )

  const vectorCutoff = new Date(now)
  vectorCutoff.setDate(vectorCutoff.getDate() - RETENTION_DEFAULTS.vectors)

  const auditLogCutoff = new Date(now)
  auditLogCutoff.setDate(
    auditLogCutoff.getDate() - RETENTION_DEFAULTS.auditLogs
  )

  const webhookPayloadCutoff = new Date(now)
  webhookPayloadCutoff.setDate(
    webhookPayloadCutoff.getDate() - RETENTION_DEFAULTS.webhookPayloads
  )

  // Step 1: Hard delete conversations older than retention period
  const conversationResult = await db
    .delete(ConversationsTable)
    .where(lt(ConversationsTable.created_at, conversationCutoff))

  report.conversationsDeleted = conversationResult[0]?.affectedRows ?? 0

  // Step 2: Delete expired vectors.
  // Upstash filter comparisons only support numeric operands, so we paginate
  // through vectors and evaluate metadata timestamps locally.
  const vectorCutoffMs = vectorCutoff.getTime()
  const expiredVectorIds: Array<string | number> = []
  let cursor: string | number = 0

  while (true) {
    const page: VectorRangePage = await vectorIndex.range({
      cursor,
      limit: VECTOR_RANGE_PAGE_SIZE,
      includeMetadata: true,
    })

    const vectors = Array.isArray(page?.vectors) ? page.vectors : []
    for (const vector of vectors) {
      if (isVectorExpired(vector, vectorCutoffMs)) {
        expiredVectorIds.push(vector.id)
      }
    }

    const nextCursor: string | number | null | undefined = page?.nextCursor
    if (
      nextCursor === undefined ||
      nextCursor === null ||
      nextCursor === '' ||
      String(nextCursor) === String(cursor)
    ) {
      break
    }

    cursor = nextCursor
  }

  if (expiredVectorIds.length > 0) {
    for (let i = 0; i < expiredVectorIds.length; i += VECTOR_RANGE_PAGE_SIZE) {
      const idsChunk = expiredVectorIds.slice(i, i + VECTOR_RANGE_PAGE_SIZE)
      const deleteResult = await vectorIndex.delete(idsChunk)
      report.vectorsDeleted += deleteResult.deleted || 0
    }
  }

  // Step 3: Hard delete audit logs older than retention period
  const auditLogResult = await db
    .delete(AuditLogTable)
    .where(lt(AuditLogTable.created_at, auditLogCutoff))

  report.auditLogsDeleted = auditLogResult[0]?.affectedRows ?? 0

  // Step 4: Hard delete webhook payload snapshots older than retention period
  const webhookPayloadResult = await db
    .delete(WebhookPayloadSnapshotsTable)
    .where(lt(WebhookPayloadSnapshotsTable.created_at, webhookPayloadCutoff))

  report.webhookPayloadsDeleted = webhookPayloadResult[0]?.affectedRows ?? 0

  return report
}
