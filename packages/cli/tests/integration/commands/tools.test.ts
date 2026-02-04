import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestContext } from '../../helpers/test-context'

const mockGetDb = vi.hoisted(() => vi.fn())
const mockEq = vi.hoisted(() => vi.fn(() => ({})))
const mockSearchContent = vi.hoisted(() => vi.fn())
const mockLookupUser = vi.hoisted(() => vi.fn())
const mockGetPurchases = vi.hoisted(() => vi.fn())
const mockIntegrationClient = vi.hoisted(() => vi.fn())

vi.mock('@skillrecordings/database', () => ({
  AppsTable: {
    slug: 'slug',
    name: 'name',
    integration_base_url: 'integration_base_url',
    webhook_secret: 'webhook_secret',
    stripe_account_id: 'stripe_account_id',
    instructor_teammate_id: 'instructor_teammate_id',
  },
  eq: mockEq,
  getDb: mockGetDb,
}))

vi.mock('@skillrecordings/sdk/client', () => ({
  IntegrationClient: mockIntegrationClient,
}))

import {
  listApps,
  lookupUser,
  searchContent,
} from '../../../src/commands/tools'

type AppRow = {
  slug: string
  name: string
  integration_base_url: string | null
  webhook_secret: string | null
  stripe_account_id: string | null
  instructor_teammate_id: string | null
}

const parseLastJson = (stdout: string) => {
  const lines = stdout.split('\n').filter((line) => line.trim().length > 0)
  return JSON.parse(lines[lines.length - 1] ?? 'null')
}

describe('tools commands', () => {
  let appsResult: Array<{ slug: string; name: string; baseUrl: string | null }>
  let appResult: AppRow | null

  beforeEach(() => {
    appsResult = []
    appResult = null

    mockSearchContent.mockReset()
    mockLookupUser.mockReset()
    mockGetPurchases.mockReset()
    mockIntegrationClient.mockReset()
    mockGetDb.mockReset()
    mockEq.mockClear()

    mockIntegrationClient.mockImplementation(() => ({
      searchContent: mockSearchContent,
      lookupUser: mockLookupUser,
      getPurchases: mockGetPurchases,
    }))

    mockGetDb.mockImplementation(() => ({
      select: (selection?: unknown) => {
        if (selection) {
          return {
            from: async () => appsResult,
          }
        }
        return {
          from: () => ({
            where: () => ({
              limit: async () => (appResult ? [appResult] : []),
            }),
          }),
        }
      },
    }))

    process.exitCode = undefined
  })

  it('listApps outputs JSON payload', async () => {
    appsResult = [
      { slug: 'app-1', name: 'App One', baseUrl: 'https://app.test' },
    ]

    const { ctx, getStdout, getStderr } = await createTestContext({
      format: 'json',
    })

    await listApps(ctx, { json: true })

    expect(getStderr()).toBe('')
    const payload = parseLastJson(getStdout()) as Array<{ slug: string }>
    expect(payload[0]?.slug).toBe('app-1')
  })

  it('lookupUser outputs JSON payload', async () => {
    appResult = {
      slug: 'app-1',
      name: 'App One',
      integration_base_url: 'https://app.test',
      webhook_secret: 'secret',
      stripe_account_id: null,
      instructor_teammate_id: null,
    }
    mockLookupUser.mockResolvedValueOnce({
      id: 'user-1',
      email: 'user@example.com',
    })

    const { ctx, getStdout } = await createTestContext({ format: 'json' })

    await lookupUser(ctx, 'app-1', 'user@example.com', { json: true })

    const payload = parseLastJson(getStdout()) as { id: string }
    expect(payload.id).toBe('user-1')
  })

  it('searchContent reports errors', async () => {
    appResult = {
      slug: 'app-1',
      name: 'App One',
      integration_base_url: 'https://app.test',
      webhook_secret: 'secret',
      stripe_account_id: null,
      instructor_teammate_id: null,
    }
    mockSearchContent.mockRejectedValueOnce(new Error('boom'))

    const { ctx, getStderr } = await createTestContext({ format: 'json' })

    await searchContent(ctx, 'app-1', 'test', { json: true })

    const errorOutput = getStderr()
    expect(errorOutput).toContain('Search failed.')
    expect(errorOutput).toContain('Suggestion:')
    expect(process.exitCode).toBe(1)
  })
})
