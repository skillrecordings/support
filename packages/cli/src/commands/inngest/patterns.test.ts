/**
 * Tests for skill inngest patterns
 */

import { Writable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { type CommandContext, createContext } from '../../core/context'
import { InngestClient, parseTimeArg } from './client'
import { patterns } from './patterns'

vi.mock('./client', async () => {
  const actual = await vi.importActual('./client')
  return {
    ...actual,
    InngestClient: vi.fn(),
  }
})

describe('skill inngest patterns', () => {
  const mockEvents = [
    {
      internal_id: 'evt1',
      name: 'support/conversation.created',
      data: { conversationId: 'conv1' },
      received_at: '2024-01-15T10:00:00Z',
    },
    {
      internal_id: 'evt2',
      name: 'support/conversation.created',
      data: { conversationId: 'conv2' },
      received_at: '2024-01-15T10:05:00Z',
    },
    {
      internal_id: 'evt3',
      name: 'inngest/function.finished',
      data: {
        function_id: 'support-agent-workflow',
        run_id: 'run1',
        _inngest: { status: 'Completed' },
      },
      received_at: '2024-01-15T10:01:00Z',
    },
    {
      internal_id: 'evt4',
      name: 'inngest/function.finished',
      data: {
        function_id: 'support-agent-workflow',
        run_id: 'run2',
        error: { message: 'Rate limit exceeded' },
        _inngest: { status: 'Failed' },
      },
      received_at: '2024-01-15T10:06:00Z',
    },
    {
      internal_id: 'evt5',
      name: 'inngest/function.finished',
      data: {
        function_id: 'email-notification',
        run_id: 'run3',
        _inngest: { status: 'Completed' },
      },
      received_at: '2024-01-15T10:10:00Z',
    },
  ]

  const captureOutput = () => {
    const chunks: string[] = []
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(chunk.toString())
        callback()
      },
    })
    return { stream, getOutput: () => chunks.join('') }
  }

  it('aggregates event patterns by name', async () => {
    const { stream, getOutput } = captureOutput()
    const ctx = await createContext({
      format: 'json',
      quiet: true,
      stdout: stream as never,
    })
    const mockClient = {
      listEvents: vi.fn().mockResolvedValue({ data: mockEvents }),
    }
    vi.mocked(InngestClient).mockImplementation(() => mockClient as never)

    await patterns(ctx, {})

    expect(mockClient.listEvents).toHaveBeenCalledWith({
      limit: 100,
    })

    const output = JSON.parse(getOutput())

    expect(output).toMatchObject({
      time_range: '24h',
      total_events: 5,
      events_by_name: {
        'support/conversation.created': 2,
        'inngest/function.finished': 3,
      },
    })
  })

  it('aggregates by function with success rates', async () => {
    const { stream, getOutput } = captureOutput()
    const ctx = await createContext({
      format: 'json',
      quiet: true,
      stdout: stream as never,
    })
    const mockClient = {
      listEvents: vi.fn().mockResolvedValue({ data: mockEvents }),
    }
    vi.mocked(InngestClient).mockImplementation(() => mockClient as never)

    await patterns(ctx, {})

    const output = JSON.parse(getOutput())

    expect(output.by_function).toEqual({
      'support-agent-workflow': {
        success: 1,
        failed: 1,
        success_rate: 0.5,
      },
      'email-notification': {
        success: 1,
        failed: 0,
        success_rate: 1,
      },
    })
  })

  it('respects --after time flag', async () => {
    const { stream } = captureOutput()
    const ctx = await createContext({
      format: 'json',
      quiet: true,
      stdout: stream as never,
    })
    const mockClient = {
      listEvents: vi.fn().mockResolvedValue({ data: [] }),
    }
    vi.mocked(InngestClient).mockImplementation(() => mockClient as never)

    await patterns(ctx, { after: '2h' })

    // parseTimeArg will convert "2h" to an ISO timestamp
    const calls = mockClient.listEvents.mock.calls
    expect(calls).toHaveLength(1)
    const firstCall = calls[0]
    expect(firstCall).toBeDefined()
    expect(firstCall?.[0]).toHaveProperty('limit', 100)
    expect(firstCall?.[0]).toHaveProperty('received_after')
    expect(typeof firstCall?.[0]?.received_after).toBe('string')
  })

  it('calculates frequency (events per hour)', async () => {
    const { stream, getOutput } = captureOutput()
    const ctx = await createContext({
      format: 'json',
      quiet: true,
      stdout: stream as never,
    })
    const mockClient = {
      listEvents: vi.fn().mockResolvedValue({ data: mockEvents }),
    }
    vi.mocked(InngestClient).mockImplementation(() => mockClient as never)

    await patterns(ctx, { after: '1h' })

    const output = JSON.parse(getOutput())

    // 2 support/conversation.created events over 1 hour window
    expect(output.events_by_name['support/conversation.created']).toBe(2)
  })

  it('outputs text format with tables', async () => {
    const { stream, getOutput } = captureOutput()
    const ctx = await createContext({
      format: 'text',
      quiet: true,
      stdout: stream as never,
    })
    const mockClient = {
      listEvents: vi.fn().mockResolvedValue({ data: mockEvents }),
    }
    vi.mocked(InngestClient).mockImplementation(() => mockClient as never)

    await patterns(ctx, {})

    const output = getOutput()

    expect(output).toContain('Event Patterns')
    expect(output).toContain('support/conversation.created')
    expect(output).toContain('inngest/function.finished')
    expect(output).toContain('Function Stats')
    expect(output).toContain('support-agent-workflow')
  })

  it('includes hint for failures command', async () => {
    const { stream, getOutput } = captureOutput()
    const ctx = await createContext({
      format: 'text',
      quiet: true,
      stdout: stream as never,
    })
    const mockClient = {
      listEvents: vi.fn().mockResolvedValue({ data: mockEvents }),
    }
    vi.mocked(InngestClient).mockImplementation(() => mockClient as never)

    await patterns(ctx, {})

    const output = getOutput()

    expect(output).toContain('skill inngest failures')
  })

  it('handles empty events', async () => {
    const { stream, getOutput } = captureOutput()
    const ctx = await createContext({
      format: 'json',
      quiet: true,
      stdout: stream as never,
    })
    const mockClient = {
      listEvents: vi.fn().mockResolvedValue({ data: [] }),
    }
    vi.mocked(InngestClient).mockImplementation(() => mockClient as never)

    await patterns(ctx, {})

    const output = JSON.parse(getOutput())

    expect(output).toMatchObject({
      total_events: 0,
      events_by_name: {},
      by_function: {},
    })
  })

  it('handles client errors gracefully', async () => {
    const { stream } = captureOutput()
    const ctx = await createContext({
      format: 'json',
      quiet: true,
      stdout: stream as never,
      stderr: stream as never,
    })
    const mockClient = {
      listEvents: vi.fn().mockRejectedValue(new Error('Network error')),
    }
    vi.mocked(InngestClient).mockImplementation(() => mockClient as never)

    await patterns(ctx, {})

    expect(process.exitCode).toBe(1)
  })
})
