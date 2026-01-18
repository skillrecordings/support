/**
 * Retention policies and cleanup service
 *
 * Handles soft deletion with grace period before hard deletion.
 * Runs as an Inngest cron workflow daily at 3am.
 */

export const RETENTION_DEFAULTS = {
  conversations: 90, // days
  vectors: 180,
  auditLogs: 365,
  gracePeriod: 7,
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
 * 1. Soft delete records past retention period (set deletedAt)
 * 2. Hard delete soft-deleted records past grace period
 * 3. Delete expired vectors from vector index
 *
 * @param db - Database connection
 * @param vectorIndex - Vector index client
 * @returns Cleanup report with counts
 */
export async function cleanupExpiredData(
  db: any,
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

  const gracePeriodCutoff = new Date(now)
  gracePeriodCutoff.setDate(
    gracePeriodCutoff.getDate() - RETENTION_DEFAULTS.gracePeriod
  )

  // Step 1: Find and soft-delete expired conversations
  const expiredConversations = await db.query({
    sql: `
      SELECT id FROM conversations
      WHERE createdAt < ?
      AND deletedAt IS NULL
    `,
    values: [conversationCutoff],
  })

  if (expiredConversations.length > 0) {
    await db.execute({
      sql: `
        UPDATE conversations
        SET deletedAt = ?
        WHERE id IN (${expiredConversations.map(() => '?').join(',')})
      `,
      values: [now, ...expiredConversations.map((c: any) => c.id)],
    })
  }

  // Step 2: Hard delete soft-deleted conversations past grace period
  const softDeletedConversations = await db.query({
    sql: `
      SELECT id FROM conversations
      WHERE deletedAt IS NOT NULL
      AND deletedAt < ?
    `,
    values: [gracePeriodCutoff],
  })

  if (softDeletedConversations.length > 0) {
    const result = await db.execute({
      sql: `
        DELETE FROM conversations
        WHERE id IN (${softDeletedConversations.map(() => '?').join(',')})
      `,
      values: softDeletedConversations.map((c: any) => c.id),
    })
    report.conversationsDeleted = result.rowsAffected || 0
  }

  // Step 3: Delete expired vectors
  const expiredVectors = await vectorIndex.query({
    filter: `createdAt < "${vectorCutoff.toISOString()}"`,
  })

  if (expiredVectors.length > 0) {
    const vectorIds = expiredVectors.map((v: any) => v.id)
    const deleteResult = await vectorIndex.delete(vectorIds)
    report.vectorsDeleted = deleteResult.deleted || 0
  }

  // Step 4: Delete expired audit logs
  const expiredAuditLogs = await db.query({
    sql: `
      SELECT id FROM audit_logs
      WHERE createdAt < ?
    `,
    values: [auditLogCutoff],
  })

  if (expiredAuditLogs.length > 0) {
    const result = await db.execute({
      sql: `
        DELETE FROM audit_logs
        WHERE id IN (${expiredAuditLogs.map(() => '?').join(',')})
      `,
      values: expiredAuditLogs.map((l: any) => l.id),
    })
    report.auditLogsDeleted = result.rowsAffected || 0
  }

  return report
}
