import type { ProductStatus } from '@skillrecordings/sdk/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExecutionContext } from './types'

// Store mock function in module scope - will be used by mock factory
let mockGetProductStatusImpl: ReturnType<typeof vi.fn>

// Mock the app registry
vi.mock('../services/app-registry', () => ({
  getApp: vi.fn(),
}))

// Mock the IntegrationClient - factory runs once at module load
// But we reference the module-scoped mockGetProductStatusImpl which can be changed per test
vi.mock('@skillrecordings/sdk/client', () => {
  return {
    IntegrationClient: vi.fn().mockImplementation(() => ({
      getProductStatus: (...args: unknown[]) =>
        mockGetProductStatusImpl(...args),
    })),
  }
})

import { getApp } from '../services/app-registry'
// Import after mocks are set up
import { checkProductAvailability } from './check-product-availability'

const mockGetApp = vi.mocked(getApp)

describe('checkProductAvailability', () => {
  const mockContext: ExecutionContext = {
    user: {
      id: 'usr_123',
      email: 'test@example.com',
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
    mockGetApp.mockResolvedValue(mockApp as any)
    // Reset the mock implementation
    mockGetProductStatusImpl = vi.fn()
  })

  describe('successful availability checks', () => {
    it('returns available product with seat count', async () => {
      const productStatus: ProductStatus = {
        productId: 'ts-workshop',
        productType: 'live',
        available: true,
        soldOut: false,
        quantityAvailable: 50,
        quantityRemaining: 12,
        state: 'active',
        startsAt: '2026-02-01T10:00:00Z',
      }

      mockGetProductStatusImpl = vi.fn().mockResolvedValue(productStatus)

      const result = await checkProductAvailability.execute(
        { productId: 'ts-workshop', appId: 'total-typescript' },
        mockContext
      )

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.found).toBe(true)
        expect(result.data.status?.soldOut).toBe(false)
        expect(result.data.status?.quantityRemaining).toBe(12)
        expect(result.data.summary).toContain('live workshop')
        expect(result.data.summary).toContain('12 of 50 seats remaining')
      }
    })

    it('returns sold out product', async () => {
      const productStatus: ProductStatus = {
        productId: 'ts-workshop',
        productType: 'live',
        available: false,
        soldOut: true,
        quantityAvailable: 50,
        quantityRemaining: 0,
        state: 'active',
      }

      mockGetProductStatusImpl = vi.fn().mockResolvedValue(productStatus)

      const result = await checkProductAvailability.execute(
        { productId: 'ts-workshop', appId: 'total-typescript' },
        mockContext
      )

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.found).toBe(true)
        expect(result.data.status?.soldOut).toBe(true)
        expect(result.data.summary).toContain('SOLD OUT')
        expect(result.data.summary).toContain('50 seats')
      }
    })

    it('returns self-paced product with unlimited availability', async () => {
      const productStatus: ProductStatus = {
        productId: 'ts-essentials',
        productType: 'self-paced',
        available: true,
        soldOut: false,
        quantityAvailable: -1,
        quantityRemaining: -1,
        state: 'active',
      }

      mockGetProductStatusImpl = vi.fn().mockResolvedValue(productStatus)

      const result = await checkProductAvailability.execute(
        { productId: 'ts-essentials', appId: 'total-typescript' },
        mockContext
      )

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.found).toBe(true)
        expect(result.data.summary).toContain('self-paced')
        expect(result.data.summary).toContain('Unlimited availability')
      }
    })

    it('returns cohort with enrollment window', async () => {
      const productStatus: ProductStatus = {
        productId: 'ts-cohort-spring',
        productType: 'cohort',
        available: true,
        soldOut: false,
        quantityAvailable: 30,
        quantityRemaining: 5,
        state: 'active',
        enrollmentOpen: '2026-01-15T00:00:00Z',
        enrollmentClose: '2026-01-31T23:59:59Z',
        startsAt: '2026-02-05T10:00:00Z',
      }

      mockGetProductStatusImpl = vi.fn().mockResolvedValue(productStatus)

      const result = await checkProductAvailability.execute(
        { productId: 'ts-cohort-spring', appId: 'total-typescript' },
        mockContext
      )

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.found).toBe(true)
        expect(result.data.summary).toContain('cohort')
        expect(result.data.summary).toContain('Enrollment window')
        expect(result.data.summary).toContain('5 of 30 seats remaining')
      }
    })
  })

  describe('product not found', () => {
    it('handles null response from integration', async () => {
      mockGetProductStatusImpl = vi.fn().mockResolvedValue(null)

      const result = await checkProductAvailability.execute(
        { productId: 'non-existent', appId: 'total-typescript' },
        mockContext
      )

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.found).toBe(false)
        expect(result.data.status).toBeNull()
        expect(result.data.summary).toContain('not found')
      }
    })
  })

  describe('error handling', () => {
    it('returns error when app not found', async () => {
      mockGetApp.mockResolvedValue(null)

      const result = await checkProductAvailability.execute(
        { productId: 'ts-workshop', appId: 'unknown-app' },
        mockContext
      )

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('EXECUTION_ERROR')
        expect(result.error.message).toContain('App not found')
      }
    })

    it('handles method not implemented gracefully', async () => {
      mockGetProductStatusImpl = vi
        .fn()
        .mockRejectedValue(
          new Error('Method not implemented: getProductStatus')
        )

      const result = await checkProductAvailability.execute(
        { productId: 'ts-workshop', appId: 'total-typescript' },
        mockContext
      )

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.found).toBe(false)
        expect(result.data.summary).toContain('does not support')
        expect(result.data.error).toContain('not implemented')
      }
    })

    it('handles network errors', async () => {
      mockGetProductStatusImpl = vi
        .fn()
        .mockRejectedValue(new Error('Network error'))

      const result = await checkProductAvailability.execute(
        { productId: 'ts-workshop', appId: 'total-typescript' },
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
    it('has correct name and description', () => {
      expect(checkProductAvailability.name).toBe('check_product_availability')
      expect(checkProductAvailability.description).toContain('availability')
      expect(checkProductAvailability.description).toContain('ALWAYS')
    })
  })
})
