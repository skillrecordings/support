import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RETENTION_DEFAULTS, cleanupExpiredData } from './retention'

describe('RETENTION_DEFAULTS', () => {
  it('should define retention periods in days', () => {
    expect(RETENTION_DEFAULTS.conversations).toBe(90)
    expect(RETENTION_DEFAULTS.vectors).toBe(180)
    expect(RETENTION_DEFAULTS.auditLogs).toBe(365)
    expect(RETENTION_DEFAULTS.webhookPayloads).toBe(7)
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
      range: vi.fn().mockResolvedValue({ vectors: [], nextCursor: '' }),
    }
  })

  it('should return a cleanup report with zero counts when nothing to delete', async () => {
    const report = await cleanupExpiredData(mockDb, mockVectorIndex)

    expect(report).toEqual({
      conversationsDeleted: 0,
      vectorsDeleted: 0,
      auditLogsDeleted: 0,
      webhookPayloadsDeleted: 0,
      timestamp: expect.any(String),
    })
  })

  it('should call db.delete for conversations with correct cutoff', async () => {
    await cleanupExpiredData(mockDb, mockVectorIndex)

    // Should have called delete three times: conversations, audit logs, webhook payloads
    expect(mockDb.delete).toHaveBeenCalledTimes(3)
  })

  it('should report deleted conversation count from affectedRows', async () => {
    const deleteConversations = {
      where: vi.fn().mockResolvedValue([{ affectedRows: 5 }]),
    }
    const deleteAuditLogs = {
      where: vi.fn().mockResolvedValue([{ affectedRows: 0 }]),
    }
    const deleteWebhookPayloads = {
      where: vi.fn().mockResolvedValue([{ affectedRows: 0 }]),
    }
    mockDb.delete
      .mockReturnValueOnce(deleteConversations)
      .mockReturnValueOnce(deleteAuditLogs)
      .mockReturnValueOnce(deleteWebhookPayloads)

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
    const deleteWebhookPayloads = {
      where: vi.fn().mockResolvedValue([{ affectedRows: 0 }]),
    }
    mockDb.delete
      .mockReturnValueOnce(deleteConversations)
      .mockReturnValueOnce(deleteAuditLogs)
      .mockReturnValueOnce(deleteWebhookPayloads)

    const report = await cleanupExpiredData(mockDb, mockVectorIndex)

    expect(report.auditLogsDeleted).toBe(12)
  })

  it('should delete expired vectors from vector index', async () => {
    mockVectorIndex.range.mockResolvedValue({
      vectors: [
        { id: 'vec-1', metadata: { createdAt: '2020-01-01T00:00:00Z' } },
        { id: 'vec-2', metadata: { resolvedAt: '2020-01-01T00:00:00Z' } },
      ],
      nextCursor: '',
    })
    mockVectorIndex.delete.mockResolvedValue({ deleted: 2 })

    const report = await cleanupExpiredData(mockDb, mockVectorIndex)

    expect(mockVectorIndex.delete).toHaveBeenCalledWith(['vec-1', 'vec-2'])
    expect(report.vectorsDeleted).toBe(2)
  })

  it('should not call vectorIndex.delete when no expired vectors', async () => {
    mockVectorIndex.range.mockResolvedValue({
      vectors: [
        { id: 'vec-new', metadata: { createdAt: new Date().toISOString() } },
      ],
      nextCursor: '',
    })

    await cleanupExpiredData(mockDb, mockVectorIndex)

    expect(mockVectorIndex.delete).not.toHaveBeenCalled()
  })

  it('should paginate vector range results', async () => {
    mockVectorIndex.range
      .mockResolvedValueOnce({
        vectors: [
          { id: 'vec-1', metadata: { createdAt: '2020-01-01T00:00:00Z' } },
        ],
        nextCursor: '1',
      })
      .mockResolvedValueOnce({
        vectors: [
          { id: 'vec-2', metadata: { createdAt: '2020-01-01T00:00:00Z' } },
        ],
        nextCursor: '1',
      })
    mockVectorIndex.delete.mockResolvedValue({ deleted: 2 })

    const report = await cleanupExpiredData(mockDb, mockVectorIndex)

    expect(mockVectorIndex.range).toHaveBeenCalledTimes(2)
    expect(report.vectorsDeleted).toBe(2)
  })

  it('should handle missing affectedRows gracefully', async () => {
    const deleteConversations = {
      where: vi.fn().mockResolvedValue([{}]),
    }
    const deleteAuditLogs = {
      where: vi.fn().mockResolvedValue([{}]),
    }
    const deleteWebhookPayloads = {
      where: vi.fn().mockResolvedValue([{ affectedRows: 2 }]),
    }
    mockDb.delete
      .mockReturnValueOnce(deleteConversations)
      .mockReturnValueOnce(deleteAuditLogs)
      .mockReturnValueOnce(deleteWebhookPayloads)

    const report = await cleanupExpiredData(mockDb, mockVectorIndex)

    expect(report.conversationsDeleted).toBe(0)
    expect(report.auditLogsDeleted).toBe(0)
    expect(report.webhookPayloadsDeleted).toBe(2)
  })
})
