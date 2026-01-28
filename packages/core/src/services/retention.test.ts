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
  })

  it('should not have gracePeriod (no soft-delete support)', () => {
    expect('gracePeriod' in RETENTION_DEFAULTS).toBe(false)
  })
})

describe('cleanupExpiredData', () => {
  let mockDb: any
  let mockVectorIndex: any

  beforeEach(() => {
    // Drizzle delete() returns a chainable that resolves to [ResultSetHeader]
    const mockDeleteChain = {
      where: vi.fn().mockResolvedValue([{ affectedRows: 0 }]),
    }
    mockDb = {
      delete: vi.fn().mockReturnValue(mockDeleteChain),
    }
    mockVectorIndex = {
      delete: vi.fn(),
      query: vi.fn(),
    }
  })

  it('should return a cleanup report with zero counts when nothing to delete', async () => {
    mockVectorIndex.query.mockResolvedValue([])

    const report = await cleanupExpiredData(mockDb, mockVectorIndex)

    expect(report).toEqual({
      conversationsDeleted: 0,
      vectorsDeleted: 0,
      auditLogsDeleted: 0,
      timestamp: expect.any(String),
    })
  })

  it('should call db.delete for conversations with correct cutoff', async () => {
    mockVectorIndex.query.mockResolvedValue([])

    await cleanupExpiredData(mockDb, mockVectorIndex)

    // Should have called delete twice: once for conversations, once for audit logs
    expect(mockDb.delete).toHaveBeenCalledTimes(2)
  })

  it('should report deleted conversation count from affectedRows', async () => {
    const deleteConversations = {
      where: vi.fn().mockResolvedValue([{ affectedRows: 5 }]),
    }
    const deleteAuditLogs = {
      where: vi.fn().mockResolvedValue([{ affectedRows: 0 }]),
    }
    mockDb.delete
      .mockReturnValueOnce(deleteConversations)
      .mockReturnValueOnce(deleteAuditLogs)
    mockVectorIndex.query.mockResolvedValue([])

    const report = await cleanupExpiredData(mockDb, mockVectorIndex)

    expect(report.conversationsDeleted).toBe(5)
  })

  it('should report deleted audit log count from affectedRows', async () => {
    const deleteConversations = {
      where: vi.fn().mockResolvedValue([{ affectedRows: 0 }]),
    }
    const deleteAuditLogs = {
      where: vi.fn().mockResolvedValue([{ affectedRows: 12 }]),
    }
    mockDb.delete
      .mockReturnValueOnce(deleteConversations)
      .mockReturnValueOnce(deleteAuditLogs)
    mockVectorIndex.query.mockResolvedValue([])

    const report = await cleanupExpiredData(mockDb, mockVectorIndex)

    expect(report.auditLogsDeleted).toBe(12)
  })

  it('should delete expired vectors from vector index', async () => {
    mockVectorIndex.query.mockResolvedValue([
      { id: 'vec-1', metadata: { createdAt: '2020-01-01T00:00:00Z' } },
      { id: 'vec-2', metadata: { createdAt: '2020-01-01T00:00:00Z' } },
    ])
    mockVectorIndex.delete.mockResolvedValue({ deleted: 2 })

    const report = await cleanupExpiredData(mockDb, mockVectorIndex)

    expect(mockVectorIndex.delete).toHaveBeenCalledWith(['vec-1', 'vec-2'])
    expect(report.vectorsDeleted).toBe(2)
  })

  it('should not call vectorIndex.delete when no expired vectors', async () => {
    mockVectorIndex.query.mockResolvedValue([])

    await cleanupExpiredData(mockDb, mockVectorIndex)

    expect(mockVectorIndex.delete).not.toHaveBeenCalled()
  })

  it('should handle missing affectedRows gracefully', async () => {
    const deleteConversations = {
      where: vi.fn().mockResolvedValue([{}]),
    }
    const deleteAuditLogs = {
      where: vi.fn().mockResolvedValue([{}]),
    }
    mockDb.delete
      .mockReturnValueOnce(deleteConversations)
      .mockReturnValueOnce(deleteAuditLogs)
    mockVectorIndex.query.mockResolvedValue([])

    const report = await cleanupExpiredData(mockDb, mockVectorIndex)

    expect(report.conversationsDeleted).toBe(0)
    expect(report.auditLogsDeleted).toBe(0)
  })
})
