import { beforeEach, describe, expect, it, vi } from 'vitest'

// Hoist mocks before imports
const mockCleanupExpiredData = vi.hoisted(() => vi.fn())
const mockGetVectorIndex = vi.hoisted(() => vi.fn())
const mockGetDb = vi.hoisted(() => vi.fn())

vi.mock('../../services/retention', () => ({
  cleanupExpiredData: mockCleanupExpiredData(),
  RETENTION_DEFAULTS: {
    conversations: 90,
    vectors: 180,
    auditLogs: 365,
    gracePeriod: 7,
  },
}))

vi.mock('../../vector/client', () => ({
  getVectorIndex: mockGetVectorIndex(),
}))

vi.mock('@skillrecordings/database', () => ({
  getDb: mockGetDb(),
}))

import { retentionCleanup } from './retention-cleanup'

describe('retentionCleanup workflow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should be defined', () => {
    expect(retentionCleanup).toBeDefined()
  })

  it('should have correct Inngest config', () => {
    expect(retentionCleanup.id()).toBe('retention-cleanup')
  })

  // Integration tests would require full Inngest runtime mocking
  // For now, we verify the function structure and exports
})
