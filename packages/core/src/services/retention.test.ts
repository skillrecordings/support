import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type CleanupReport,
  RETENTION_DEFAULTS,
  cleanupExpiredData,
} from './retention'

describe('RETENTION_DEFAULTS', () => {
  it('should define retention periods in days', () => {
    expect(RETENTION_DEFAULTS.conversations).toBe(90)
    expect(RETENTION_DEFAULTS.vectors).toBe(180)
    expect(RETENTION_DEFAULTS.auditLogs).toBe(365)
    expect(RETENTION_DEFAULTS.gracePeriod).toBe(7)
  })
})

describe('cleanupExpiredData', () => {
  let mockDb: any
  let mockVectorIndex: any

  beforeEach(() => {
    mockDb = {
      query: vi.fn(),
      execute: vi.fn(),
    }
    mockVectorIndex = {
      delete: vi.fn(),
      query: vi.fn(),
    }
  })

  it('should return a cleanup report', async () => {
    mockDb.query.mockResolvedValue([])
    mockVectorIndex.query.mockResolvedValue([])

    const report = await cleanupExpiredData(mockDb, mockVectorIndex)

    expect(report).toEqual({
      conversationsDeleted: 0,
      vectorsDeleted: 0,
      auditLogsDeleted: 0,
      timestamp: expect.any(String),
    })
  })

  it('should mark conversations for soft deletion when past retention period', async () => {
    const expiredDate = new Date()
    expiredDate.setDate(
      expiredDate.getDate() - (RETENTION_DEFAULTS.conversations + 1)
    )

    // Mock finding expired conversations, then soft-deleted, then audit logs
    mockDb.query
      .mockResolvedValueOnce([
        { id: 'conv-1', createdAt: expiredDate },
        { id: 'conv-2', createdAt: expiredDate },
      ]) // expired conversations
      .mockResolvedValueOnce([]) // soft-deleted conversations
      .mockResolvedValueOnce([]) // audit logs

    mockDb.execute.mockResolvedValue({ rowsAffected: 2 })
    mockVectorIndex.query.mockResolvedValue([])

    const report = await cleanupExpiredData(mockDb, mockVectorIndex)

    // Should have marked conversations for soft deletion
    expect(mockDb.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        sql: expect.stringContaining('deletedAt'),
      })
    )
  })

  it('should hard delete soft-deleted records after grace period', async () => {
    const gracePeriodDate = new Date()
    gracePeriodDate.setDate(
      gracePeriodDate.getDate() - (RETENTION_DEFAULTS.gracePeriod + 1)
    )

    // Mock finding soft-deleted conversations past grace period
    mockDb.query
      .mockResolvedValueOnce([]) // expired conversations
      .mockResolvedValueOnce([{ id: 'conv-1', deletedAt: gracePeriodDate }]) // soft-deleted
      .mockResolvedValueOnce([]) // audit logs

    mockDb.execute.mockResolvedValue({ rowsAffected: 1 })
    mockVectorIndex.query.mockResolvedValue([])

    const report = await cleanupExpiredData(mockDb, mockVectorIndex)

    // Should have hard deleted
    expect(mockDb.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        sql: expect.stringContaining('DELETE FROM'),
      })
    )
    expect(report.conversationsDeleted).toBe(1)
  })

  it('should delete expired vectors from vector index', async () => {
    const expiredDate = new Date()
    expiredDate.setDate(
      expiredDate.getDate() - (RETENTION_DEFAULTS.vectors + 1)
    )

    mockDb.query.mockResolvedValue([])
    mockVectorIndex.query.mockResolvedValueOnce([
      { id: 'vec-1', metadata: { createdAt: expiredDate.toISOString() } },
      { id: 'vec-2', metadata: { createdAt: expiredDate.toISOString() } },
    ])
    mockVectorIndex.delete.mockResolvedValue({ deleted: 2 })

    const report = await cleanupExpiredData(mockDb, mockVectorIndex)

    expect(mockVectorIndex.delete).toHaveBeenCalledWith(['vec-1', 'vec-2'])
    expect(report.vectorsDeleted).toBe(2)
  })

  it('should delete expired audit logs', async () => {
    const expiredDate = new Date()
    expiredDate.setDate(
      expiredDate.getDate() - (RETENTION_DEFAULTS.auditLogs + 1)
    )

    mockDb.query
      .mockResolvedValueOnce([]) // expired conversations
      .mockResolvedValueOnce([]) // soft-deleted conversations
      .mockResolvedValueOnce([
        { id: 'log-1', createdAt: expiredDate },
        { id: 'log-2', createdAt: expiredDate },
      ]) // audit logs

    mockDb.execute.mockResolvedValue({ rowsAffected: 2 })
    mockVectorIndex.query.mockResolvedValue([])

    const report = await cleanupExpiredData(mockDb, mockVectorIndex)

    expect(report.auditLogsDeleted).toBe(2)
  })
})
