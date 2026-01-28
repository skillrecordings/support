import type { LicenseInfo } from '@skillrecordings/sdk/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExecutionContext } from './types'

// Store mock functions in module scope
let mockGetLicenseInfoImpl: ReturnType<typeof vi.fn>
let mockGetAppImpl: ReturnType<typeof vi.fn>

// Mock the app registry
vi.mock('../services/app-registry', () => ({
  getApp: (...args: unknown[]) => mockGetAppImpl(...args),
}))

// Mock the IntegrationClient
vi.mock('@skillrecordings/sdk/client', () => {
  return {
    IntegrationClient: vi.fn().mockImplementation(() => ({
      getLicenseInfo: (...args: unknown[]) => mockGetLicenseInfoImpl(...args),
    })),
  }
})

import { getLicenseInfo } from './get-license-info'

describe('getLicenseInfo', () => {
  const mockContext: ExecutionContext = {
    user: {
      id: 'usr_123',
      email: '[EMAIL]',
      name: 'Test User',
    },
    purchases: [],
    appConfig: {
      id: 'total-typescript',
      name: 'Total TypeScript',
    },
    traceId: 'trace_123',
    conversationId: 'cnv_123',
  }

  const mockApp = {
    id: 'total-typescript',
    integration_base_url: 'https://totaltypescript.com/api/support',
    webhook_secret: 'whsec_test123',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetAppImpl = vi.fn().mockResolvedValue(mockApp)
    mockGetLicenseInfoImpl = vi.fn()
  })

  describe('successful license lookups', () => {
    it('returns team license with claimed seats', async () => {
      const license: LicenseInfo = {
        purchaseId: 'pur_456',
        licenseType: 'team',
        totalSeats: 10,
        claimedSeats: 7,
        availableSeats: 3,
        claimedBy: [
          { email: '[EMAIL]', claimedAt: '2025-01-15T10:00:00Z' },
          { email: '[EMAIL]', claimedAt: '2025-01-16T11:00:00Z' },
        ],
      }

      mockGetLicenseInfoImpl.mockResolvedValue(license)

      const result = await getLicenseInfo.execute(
        { purchaseId: 'pur_456', appId: 'total-typescript' },
        mockContext
      )

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.found).toBe(true)
        expect(result.data.license).toEqual(license)
        expect(result.data.summary).toContain('team')
        expect(result.data.summary).toContain('7/10 claimed')
        expect(result.data.summary).toContain('3 available')
        expect(result.data.summary).toContain('[EMAIL]')
      }
    })

    it('returns enterprise license with admin', async () => {
      const license: LicenseInfo = {
        purchaseId: 'pur_789',
        licenseType: 'enterprise',
        totalSeats: 50,
        claimedSeats: 25,
        availableSeats: 25,
        adminEmail: '[EMAIL]',
        claimedBy: [],
      }

      mockGetLicenseInfoImpl.mockResolvedValue(license)

      const result = await getLicenseInfo.execute(
        { purchaseId: 'pur_789', appId: 'total-typescript' },
        mockContext
      )

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.summary).toContain('enterprise')
        expect(result.data.summary).toContain('[EMAIL]')
      }
    })

    it('shows expiration for time-limited licenses', async () => {
      const license: LicenseInfo = {
        purchaseId: 'pur_annual',
        licenseType: 'team',
        totalSeats: 5,
        claimedSeats: 5,
        availableSeats: 0,
        expiresAt: '2026-06-01T00:00:00Z',
        claimedBy: [],
      }

      mockGetLicenseInfoImpl.mockResolvedValue(license)

      const result = await getLicenseInfo.execute(
        { purchaseId: 'pur_annual', appId: 'total-typescript' },
        mockContext
      )

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.summary).toContain('Expires:')
      }
    })

    it('shows lifetime for non-expiring licenses', async () => {
      const license: LicenseInfo = {
        purchaseId: 'pur_lifetime',
        licenseType: 'team',
        totalSeats: 10,
        claimedSeats: 2,
        availableSeats: 8,
        claimedBy: [],
      }

      mockGetLicenseInfoImpl.mockResolvedValue(license)

      const result = await getLicenseInfo.execute(
        { purchaseId: 'pur_lifetime', appId: 'total-typescript' },
        mockContext
      )

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.summary).toContain('lifetime license')
      }
    })

    it('handles license with no claimed seats', async () => {
      const license: LicenseInfo = {
        purchaseId: 'pur_new',
        licenseType: 'team',
        totalSeats: 5,
        claimedSeats: 0,
        availableSeats: 5,
        claimedBy: [],
      }

      mockGetLicenseInfoImpl.mockResolvedValue(license)

      const result = await getLicenseInfo.execute(
        { purchaseId: 'pur_new', appId: 'total-typescript' },
        mockContext
      )

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.summary).toContain('No seats claimed yet')
      }
    })
  })

  describe('license not found', () => {
    it('handles null response (individual purchase)', async () => {
      mockGetLicenseInfoImpl.mockResolvedValue(null)

      const result = await getLicenseInfo.execute(
        { purchaseId: 'pur_individual', appId: 'total-typescript' },
        mockContext
      )

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.found).toBe(false)
        expect(result.data.license).toBeNull()
        expect(result.data.summary).toContain('No license information found')
        expect(result.data.summary).toContain('individual purchase')
      }
    })
  })

  describe('501 fallback handling', () => {
    it('returns graceful error when method not implemented', async () => {
      mockGetLicenseInfoImpl.mockRejectedValue(
        new Error('Method not implemented: getLicenseInfo')
      )

      const result = await getLicenseInfo.execute(
        { purchaseId: 'pur_456', appId: 'total-typescript' },
        mockContext
      )

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.found).toBe(false)
        expect(result.data.error).toContain('not implemented')
        expect(result.data.summary).toContain(
          'does not support license info queries'
        )
      }
    })
  })

  describe('error handling', () => {
    it('returns error when app not found', async () => {
      mockGetAppImpl.mockResolvedValue(null)

      const result = await getLicenseInfo.execute(
        { purchaseId: 'pur_456', appId: 'unknown-app' },
        mockContext
      )

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('EXECUTION_ERROR')
        expect(result.error.message).toContain('App not found')
      }
    })

    it('propagates network errors', async () => {
      mockGetLicenseInfoImpl.mockRejectedValue(new Error('Network error'))

      const result = await getLicenseInfo.execute(
        { purchaseId: 'pur_456', appId: 'total-typescript' },
        mockContext
      )

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('EXECUTION_ERROR')
        expect(result.error.message).toContain('Network error')
      }
    })
  })

  describe('tool metadata', () => {
    it('has correct name', () => {
      expect(getLicenseInfo.name).toBe('get_license_info')
    })

    it('has description mentioning license and team', () => {
      expect(getLicenseInfo.description).toContain('license')
      expect(getLicenseInfo.description).toContain('seat')
    })
  })
})
