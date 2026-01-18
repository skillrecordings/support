/**
 * Retention cleanup workflow
 *
 * Runs daily at 3am to clean up expired data according to retention policies.
 * Handles soft deletion with grace period before hard deletion.
 */

import { cleanupExpiredData } from '../../services/retention'
import { getVectorIndex } from '../../vector/client'
import { inngest } from '../client'

/**
 * Daily cron job to clean up expired data.
 *
 * Schedule: 0 3 * * * (daily at 3am UTC)
 *
 * Process:
 * 1. Soft delete records past retention period
 * 2. Hard delete soft-deleted records past grace period
 * 3. Delete expired vectors from vector index
 *
 * Note: Database connection is lazy-initialized inside the step function
 * to avoid serverless/Turbopack build issues.
 */
export const retentionCleanup = inngest.createFunction(
  {
    id: 'retention-cleanup',
    name: 'Daily Retention Cleanup',
  },
  { cron: '0 3 * * *' }, // Daily at 3am UTC
  async ({ event, step }) => {
    const report = await step.run('cleanup-expired-data', async () => {
      // Lazy-init database and vector index inside the step
      // This prevents import-time initialization in serverless environments
      const { getDb } = await import('@skillrecordings/database')
      const db = getDb()
      const vectorIndex = getVectorIndex()

      return cleanupExpiredData(db, vectorIndex)
    })

    return report
  }
)
