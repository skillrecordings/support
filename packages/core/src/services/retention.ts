/**
 * Retention policies and cleanup service
 *
 * Hard-deletes records older than the configured retention period.
 * Runs as an Inngest cron workflow daily at 3am.
 */

import type { Database } from '@skillrecordings/database'
import { AuditLogTable, ConversationsTable } from '@skillrecordings/database'
import { lt, sql } from 'drizzle-orm'

export const RETENTION_DEFAULTS = {
  conversations: 90, // days
  vectors: 180,
  auditLogs: 365,
} as const

export interface CleanupReport {
  conversationsDeleted: number
  vectorsDeleted: number
  auditLogsDeleted: number
  timestamp: string
}

/**
 * Clean up expired data according to retention policies.
 *
 * Process:
 * 1. Hard delete conversations older than retention period
 * 2. Delete expired vectors from vector index
 * 3. Hard delete audit logs older than retention period
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

  // Step 1: Hard delete conversations older than retention period
  const conversationResult = await db
    .delete(ConversationsTable)
    .where(lt(ConversationsTable.created_at, conversationCutoff))

  report.conversationsDeleted = conversationResult[0]?.affectedRows ?? 0

  // Step 2: Delete expired vectors
  const expiredVectors = await vectorIndex.query({
    filter: `createdAt < "${vectorCutoff.toISOString()}"`,
  })

  if (expiredVectors.length > 0) {
    const vectorIds = expiredVectors.map((v: any) => v.id)
    const deleteResult = await vectorIndex.delete(vectorIds)
    report.vectorsDeleted = deleteResult.deleted || 0
  }

  // Step 3: Hard delete audit logs older than retention period
  const auditLogResult = await db
    .delete(AuditLogTable)
    .where(lt(AuditLogTable.created_at, auditLogCutoff))

  report.auditLogsDeleted = auditLogResult[0]?.affectedRows ?? 0

  return report
}
