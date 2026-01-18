import { beforeEach, describe, expect, it, vi } from 'vitest'

// Hoist mocks to be available in mock factories
const { mockLookupUser, mockGetPurchases, mockGetApp } = vi.hoisted(() => ({
  mockLookupUser: vi.fn(),
  mockGetPurchases: vi.fn(),
  mockGetApp: vi.fn(),
}))

vi.mock('@skillrecordings/sdk/client', () => ({
  IntegrationClient: vi.fn().mockImplementation(() => ({
    lookupUser: mockLookupUser,
    getPurchases: mockGetPurchases,
  })),
}))

vi.mock('../../services/app-registry', () => ({
  getApp: mockGetApp,
}))

import { agentTools } from '../config'

// Helper to create mock ToolExecutionOptions
const mockToolOptions = { toolCallId: 'test-call', messages: [] as any[] }

// Get the tool's execute function with proper assertion
const lookupUserExecute = agentTools.lookupUser?.execute
if (!lookupUserExecute) throw new Error('lookupUser.execute not defined')

describe('agentTools.lookupUser', () => {
  beforeEach(() => {
    mockLookupUser.mockClear()
    mockGetPurchases.mockClear()
    mockGetApp.mockClear()
  })

  it('looks up user via IntegrationClient when app is found', async () => {
    // Mock app registry returning app config
    const mockApp = {
      id: 'app-123',
      slug: 'total-typescript',
      name: 'Total TypeScript',
      integration_base_url: 'https://totaltypescript.com',
      webhook_secret: 'whsec_test123',
    }
    mockGetApp.mockResolvedValue(mockApp as any)

    // Mock IntegrationClient.lookupUser returning user data
    const mockUser = {
      id: 'user-456',
      email: 'test@example.com',
      name: 'Test User',
    }
    mockLookupUser.mockResolvedValue(mockUser)
    mockGetPurchases.mockResolvedValue([])

    const result = await lookupUserExecute(
      {
        email: 'test@example.com',
        appId: 'total-typescript',
      },
      mockToolOptions
    )

    // Verify getApp was called with appId
    expect(mockGetApp).toHaveBeenCalledWith('total-typescript')

    // Verify lookupUser was called on the client
    expect(mockLookupUser).toHaveBeenCalledWith('test@example.com')

    // Verify result contains user data
    expect(result).toEqual({
      found: true,
      user: mockUser,
      purchases: [],
    })
  })

  it('returns not found when app does not exist', async () => {
    mockGetApp.mockResolvedValue(null)

    const result = await lookupUserExecute(
      {
        email: 'test@example.com',
        appId: 'nonexistent-app',
      },
      mockToolOptions
    )

    expect(result).toEqual({
      found: false,
      error: 'App not found: nonexistent-app',
    })
  })

  it('returns not found when IntegrationClient returns null', async () => {
    const mockApp = {
      id: 'app-123',
      slug: 'total-typescript',
      integration_base_url: 'https://totaltypescript.com',
      webhook_secret: 'whsec_test123',
    }
    mockGetApp.mockResolvedValue(mockApp as any)
    mockLookupUser.mockResolvedValue(null)

    const result = await lookupUserExecute(
      {
        email: 'notfound@example.com',
        appId: 'total-typescript',
      },
      mockToolOptions
    )

    expect(result).toEqual({
      found: false,
      user: null,
      purchases: [],
    })
  })

  it('handles IntegrationClient errors gracefully', async () => {
    const mockApp = {
      id: 'app-123',
      slug: 'total-typescript',
      integration_base_url: 'https://totaltypescript.com',
      webhook_secret: 'whsec_test123',
    }
    mockGetApp.mockResolvedValue(mockApp as any)
    mockLookupUser.mockRejectedValue(new Error('Network timeout'))

    const result = await lookupUserExecute(
      {
        email: 'test@example.com',
        appId: 'total-typescript',
      },
      mockToolOptions
    )

    expect(result).toEqual({
      found: false,
      error: 'Network timeout',
    })
  })

  it('fetches purchases when user is found', async () => {
    const mockApp = {
      id: 'app-123',
      slug: 'total-typescript',
      integration_base_url: 'https://totaltypescript.com',
      webhook_secret: 'whsec_test123',
    }
    mockGetApp.mockResolvedValue(mockApp as any)

    const mockUser = {
      id: 'user-456',
      email: 'test@example.com',
      name: 'Test User',
    }
    const mockPurchases = [
      {
        id: 'pur_123',
        userId: 'user-456',
        productId: 'prod-123',
        amount: 9900,
        purchasedAt: new Date('2025-01-01'),
        status: 'active' as const,
      },
    ]

    mockLookupUser.mockResolvedValue(mockUser)
    mockGetPurchases.mockResolvedValue(mockPurchases)

    const result = await lookupUserExecute(
      {
        email: 'test@example.com',
        appId: 'total-typescript',
      },
      mockToolOptions
    )

    expect(mockGetPurchases).toHaveBeenCalledWith('user-456')
    expect(result).toEqual({
      found: true,
      user: mockUser,
      purchases: mockPurchases,
    })
  })
})
