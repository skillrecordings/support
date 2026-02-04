import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestContext } from '../../helpers/test-context'

const mockStore = vi.hoisted(() => vi.fn())
const mockFind = vi.hoisted(() => vi.fn())
const mockGet = vi.hoisted(() => vi.fn())
const mockValidate = vi.hoisted(() => vi.fn())
const mockDelete = vi.hoisted(() => vi.fn())
const mockVote = vi.hoisted(() => vi.fn())
const mockStats = vi.hoisted(() => vi.fn())
const mockListCollections = vi.hoisted(() => vi.fn())
const mockFetchAllMemories = vi.hoisted(() => vi.fn())
const mockCalculateConfidence = vi.hoisted(() => vi.fn(() => 0.75))

vi.mock('@skillrecordings/memory/memory', () => ({
  MemoryService: {
    store: mockStore,
    find: mockFind,
    get: mockGet,
    validate: mockValidate,
    delete: mockDelete,
  },
}))

vi.mock('@skillrecordings/memory/voting', () => ({
  VotingService: {
    vote: mockVote,
    stats: mockStats,
    _listCollections: mockListCollections,
    _fetchAllMemories: mockFetchAllMemories,
  },
}))

vi.mock('@skillrecordings/memory/decay', () => ({
  calculateConfidence: mockCalculateConfidence,
}))

import { get } from '../../../src/commands/memory/get'
import { store } from '../../../src/commands/memory/store'

const parseLastJson = (stdout: string) => {
  const lines = stdout.split('\n').filter((line) => line.trim().length > 0)
  return JSON.parse(lines[lines.length - 1] ?? 'null')
}

describe('memory commands', () => {
  beforeEach(() => {
    mockStore.mockReset()
    mockFind.mockReset()
    mockGet.mockReset()
    mockValidate.mockReset()
    mockDelete.mockReset()
    mockVote.mockReset()
    mockStats.mockReset()
    mockListCollections.mockReset()
    mockFetchAllMemories.mockReset()
    mockCalculateConfidence.mockClear()
    process.exitCode = undefined
  })

  it('store outputs JSON payload', async () => {
    const memory = {
      id: 'mem_1',
      content: 'Remember to follow up',
      metadata: {
        collection: 'learnings',
        source: 'human',
        tags: ['follow-up'],
        app_slug: 'app-1',
        created_at: '2024-01-01T00:00:00Z',
      },
    }
    mockStore.mockResolvedValueOnce(memory)

    const { ctx, getStdout, getStderr } = await createTestContext({
      format: 'json',
    })

    await store(ctx, 'Remember to follow up', { json: true })

    expect(getStderr()).toBe('')
    const payload = parseLastJson(getStdout()) as { id: string }
    expect(payload.id).toBe('mem_1')
  })

  it('get reports errors when memory is missing', async () => {
    mockGet.mockResolvedValueOnce(null)

    const { ctx, getStderr } = await createTestContext({ format: 'json' })

    await get(ctx, 'mem_404', { json: true })

    const errorOutput = getStderr()
    expect(errorOutput).toContain('Memory not found.')
    expect(errorOutput).toContain('Suggestion:')
    expect(process.exitCode).toBe(1)
  })
})
