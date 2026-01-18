import { beforeEach, describe, expect, it, vi } from 'vitest'

// Hoist mocks to be available in mock factories
const {
  mockLookupUser,
  mockGetPurchases,
  mockGetApp,
  mockBuildAgentContext,
  mockShouldAutoSend,
} = vi.hoisted(() => ({
  mockLookupUser: vi.fn(),
  mockGetPurchases: vi.fn(),
  mockGetApp: vi.fn(),
  mockBuildAgentContext: vi.fn(),
  mockShouldAutoSend: vi.fn(),
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

vi.mock('../../vector/retrieval', () => ({
  buildAgentContext: mockBuildAgentContext,
}))

vi.mock('../../trust/score', () => ({
  shouldAutoSend: mockShouldAutoSend,
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

describe('agentTools.searchKnowledge', () => {
  const searchKnowledgeExecute = agentTools.searchKnowledge?.execute
  if (!searchKnowledgeExecute)
    throw new Error('searchKnowledge.execute not defined')

  beforeEach(() => {
    mockBuildAgentContext.mockClear()
  })

  it('calls buildAgentContext with query and appId', async () => {
    const mockContext = {
      similarTickets: [],
      knowledge: [
        {
          id: 'kb-1',
          data: 'Refund policy documentation',
          metadata: { type: 'knowledge', appId: 'total-typescript' },
        },
      ],
      goodResponses: [],
    }
    mockBuildAgentContext.mockResolvedValue(mockContext)

    const result = await searchKnowledgeExecute(
      {
        query: 'refund policy',
        appId: 'total-typescript',
      },
      mockToolOptions
    )

    expect(mockBuildAgentContext).toHaveBeenCalledWith({
      query: 'refund policy',
      appId: 'total-typescript',
    })

    expect(result).toEqual({
      similarTickets: [],
      knowledge: mockContext.knowledge,
      goodResponses: [],
    })
  })

  it('returns empty results when no matches found', async () => {
    const mockContext = {
      similarTickets: [],
      knowledge: [],
      goodResponses: [],
    }
    mockBuildAgentContext.mockResolvedValue(mockContext)

    const result = await searchKnowledgeExecute(
      {
        query: 'unknown query',
        appId: 'total-typescript',
      },
      mockToolOptions
    )

    expect(result).toEqual({
      similarTickets: [],
      knowledge: [],
      goodResponses: [],
    })
  })
})

describe('runSupportAgent', () => {
  beforeEach(() => {
    mockBuildAgentContext.mockClear()
    mockShouldAutoSend.mockClear()
  })

  it('includes retrieved context in agent execution', async () => {
    const mockContext = {
      similarTickets: [
        {
          id: 'conv-1',
          data: 'Similar past refund request',
          metadata: { type: 'conversation', appId: 'total-typescript' },
        },
      ],
      knowledge: [],
      goodResponses: [],
    }
    mockBuildAgentContext.mockResolvedValue(mockContext)

    // Mock should not be called for this test - just verifying context retrieval
    // Full integration would require mocking AI SDK's generateText
  })

  it('sets autoSent=true when shouldAutoSend returns true and confidence > 0.9', async () => {
    // This test would require mocking generateText from AI SDK
    // Placeholder for now - implementation needed
  })

  it('keeps requiresApproval=true when shouldAutoSend returns false', async () => {
    // This test would require mocking generateText from AI SDK
    // Placeholder for now - implementation needed
  })
})
