import type { LinearClient } from '@linear/sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createContext } from '../../core/context'
import { getLinearClient } from './client'
import { listIssues } from './list'

// Mock the client module
vi.mock('./client', () => ({
  getLinearClient: vi.fn(),
}))

describe('listIssues - time filters', () => {
  let mockClient: {
    issues: ReturnType<typeof vi.fn>
    teams: ReturnType<typeof vi.fn>
  }
  let ctx: Awaited<ReturnType<typeof createContext>>

  beforeEach(async () => {
    mockClient = {
      issues: vi.fn(),
      teams: vi.fn(),
    }
    ;(getLinearClient as ReturnType<typeof vi.fn>).mockReturnValue(
      mockClient as unknown as LinearClient
    )
    ctx = await createContext({ format: 'text', verbose: false, quiet: false })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('should filter issues older than 90 days', async () => {
    mockClient.issues.mockResolvedValue({ nodes: [] })

    await listIssues(ctx, { olderThan: '90d' })

    expect(mockClient.issues).toHaveBeenCalledWith({
      first: 20,
      filter: {
        state: { type: { neq: 'canceled' } },
        updatedAt: { lt: expect.any(Date) },
      },
    })

    // Verify the date is approximately 90 days ago
    const call = mockClient.issues.mock.calls[0]?.[0]
    if (!call) throw new Error('Expected call')
    const filterDate = call.filter.updatedAt.lt as Date
    const expectedDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
    const diff = Math.abs(filterDate.getTime() - expectedDate.getTime())
    expect(diff).toBeLessThan(1000) // within 1 second
  })

  it('should filter issues older than 2 weeks', async () => {
    mockClient.issues.mockResolvedValue({ nodes: [] })

    await listIssues(ctx, { olderThan: '2w' })

    const call = mockClient.issues.mock.calls[0]?.[0]
    if (!call) throw new Error('Expected call')
    const filterDate = call.filter.updatedAt.lt as Date
    const expectedDate = new Date(Date.now() - 2 * 7 * 24 * 60 * 60 * 1000)
    const diff = Math.abs(filterDate.getTime() - expectedDate.getTime())
    expect(diff).toBeLessThan(1000)
  })

  it('should filter issues older than 24 hours', async () => {
    mockClient.issues.mockResolvedValue({ nodes: [] })

    await listIssues(ctx, { olderThan: '24h' })

    const call = mockClient.issues.mock.calls[0]?.[0]
    if (!call) throw new Error('Expected call')
    const filterDate = call.filter.updatedAt.lt as Date
    const expectedDate = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const diff = Math.abs(filterDate.getTime() - expectedDate.getTime())
    expect(diff).toBeLessThan(1000)
  })

  it('should filter issues older than 3 months', async () => {
    mockClient.issues.mockResolvedValue({ nodes: [] })

    await listIssues(ctx, { olderThan: '3m' })

    const call = mockClient.issues.mock.calls[0]?.[0]
    if (!call) throw new Error('Expected call')
    const filterDate = call.filter.updatedAt.lt as Date
    const expectedDate = new Date(Date.now() - 3 * 30 * 24 * 60 * 60 * 1000)
    const diff = Math.abs(filterDate.getTime() - expectedDate.getTime())
    expect(diff).toBeLessThan(1000)
  })

  it('should throw error for invalid time format', async () => {
    mockClient.issues.mockResolvedValue({ nodes: [] })

    await expect(listIssues(ctx, { olderThan: 'invalid' })).rejects.toThrow()
  })
})

describe('listIssues - export flag', () => {
  let mockClient: {
    issues: ReturnType<typeof vi.fn>
  }
  let ctx: Awaited<ReturnType<typeof createContext>>

  beforeEach(async () => {
    mockClient = {
      issues: vi.fn(),
    }
    ;(getLinearClient as ReturnType<typeof vi.fn>).mockReturnValue(
      mockClient as unknown as LinearClient
    )
    ctx = await createContext({ format: 'text', verbose: false, quiet: false })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('should include full issue details in JSON mode with export flag', async () => {
    const mockIssue = {
      id: 'issue-1',
      identifier: 'ENG-123',
      title: 'Test Issue',
      description: 'Full description here',
      priority: 1,
      url: 'https://linear.app/issue/ENG-123',
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-15'),
      state: Promise.resolve({ name: 'In Progress', type: 'started' }),
      assignee: Promise.resolve(null),
      team: Promise.resolve({ key: 'ENG', name: 'Engineering' }),
      labels: vi.fn().mockResolvedValue({
        nodes: [{ name: 'bug' }, { name: 'frontend' }],
      }),
      comments: vi.fn().mockResolvedValue({
        nodes: [
          {
            body: 'Comment 1',
            user: Promise.resolve({ name: 'User 1' }),
            createdAt: new Date('2024-01-10'),
          },
        ],
      }),
    }

    mockClient.issues.mockResolvedValue({ nodes: [mockIssue] })
    ctx = await createContext({ format: 'json', verbose: false, quiet: false })

    // Capture output
    const outputData: string[] = []
    ctx.output.data = (msg: string) => {
      outputData.push(msg)
    }

    await listIssues(ctx, { export: true })

    const output = JSON.parse(outputData.join(''))
    const issue = output.data.issues[0]

    expect(issue.description).toBe('Full description here')
    expect(issue.labels).toEqual(['bug', 'frontend'])
    expect(issue.comments).toHaveLength(1)
    expect(issue.comments[0].body).toBe('Comment 1')
  })

  it('should include full details in text mode with export flag', async () => {
    const mockIssue = {
      id: 'issue-1',
      identifier: 'ENG-123',
      title: 'Test Issue',
      description: 'Full description here',
      priority: 1,
      url: 'https://linear.app/issue/ENG-123',
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-15'),
      state: Promise.resolve({ name: 'In Progress', type: 'started' }),
      assignee: Promise.resolve(null),
      team: Promise.resolve({ key: 'ENG', name: 'Engineering' }),
      labels: vi.fn().mockResolvedValue({
        nodes: [{ name: 'bug' }],
      }),
      comments: vi.fn().mockResolvedValue({
        nodes: [],
      }),
    }

    mockClient.issues.mockResolvedValue({ nodes: [mockIssue] })
    ctx = await createContext({ format: 'text', verbose: false, quiet: false })

    const outputData: string[] = []
    ctx.output.data = (msg: string) => {
      outputData.push(msg)
    }

    await listIssues(ctx, { export: true })

    const output = outputData.join('\n')
    expect(output).toContain('Full description here')
    expect(output).toContain('Labels: bug')
  })
})
