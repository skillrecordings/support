import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestContext } from '../../helpers/test-context'

type InngestMockState = {
  mockListEvents: ReturnType<typeof vi.fn>
  mockGetEvent: ReturnType<typeof vi.fn>
  mockGetEventRuns: ReturnType<typeof vi.fn>
  mockGetRun: ReturnType<typeof vi.fn>
  mockSendSignal: ReturnType<typeof vi.fn>
  mockReplayEvent: ReturnType<typeof vi.fn>
  mockDetectDevServer: ReturnType<typeof vi.fn>
  mockParseTimeArg: ReturnType<typeof vi.fn>
  MockInngestClient: new () => {
    listEvents: ReturnType<typeof vi.fn>
    getEvent: ReturnType<typeof vi.fn>
    getEventRuns: ReturnType<typeof vi.fn>
    getRun: ReturnType<typeof vi.fn>
    sendSignal: ReturnType<typeof vi.fn>
    replayEvent: ReturnType<typeof vi.fn>
  }
}

function getMockState(): InngestMockState {
  const globalState = globalThis as { __inngestMocks?: InngestMockState }
  if (!globalState.__inngestMocks) {
    const mockListEvents = vi.fn()
    const mockGetEvent = vi.fn()
    const mockGetEventRuns = vi.fn()
    const mockGetRun = vi.fn()
    const mockSendSignal = vi.fn()
    const mockReplayEvent = vi.fn()
    const mockDetectDevServer = vi.fn(async () => false)
    const mockParseTimeArg = vi.fn((value: string) => value)

    class MockInngestClient {
      listEvents = mockListEvents
      getEvent = mockGetEvent
      getEventRuns = mockGetEventRuns
      getRun = mockGetRun
      sendSignal = mockSendSignal
      replayEvent = mockReplayEvent

      constructor(_opts?: { dev?: boolean }) {}
    }

    globalState.__inngestMocks = {
      mockListEvents,
      mockGetEvent,
      mockGetEventRuns,
      mockGetRun,
      mockSendSignal,
      mockReplayEvent,
      mockDetectDevServer,
      mockParseTimeArg,
      MockInngestClient,
    }
  }

  return globalState.__inngestMocks
}

vi.mock('../../../src/commands/inngest/client.js', () => {
  const state = getMockState()
  return {
    InngestClient: state.MockInngestClient,
    detectDevServer: state.mockDetectDevServer,
    parseTimeArg: state.mockParseTimeArg,
    __mocks: state,
  }
})

vi.mock('../../../src/commands/inngest/client', () => {
  const state = getMockState()
  return {
    InngestClient: state.MockInngestClient,
    detectDevServer: state.mockDetectDevServer,
    parseTimeArg: state.mockParseTimeArg,
    __mocks: state,
  }
})

import { __mocks } from '../../../src/commands/inngest/client.js'

const {
  mockListEvents,
  mockGetEvent,
  mockGetEventRuns,
  mockGetRun,
  mockSendSignal,
  mockReplayEvent,
  mockDetectDevServer,
  mockParseTimeArg,
} = __mocks as InngestMockState

import { getEvent, listEvents } from '../../../src/commands/inngest/events'
import {
  failures,
  inspect,
  search,
  stats,
} from '../../../src/commands/inngest/investigate'
import { runCommand } from '../../../src/commands/inngest/runs'
import { signalCommand } from '../../../src/commands/inngest/signal'

const parseLastJson = (stdout: string) => {
  const lines = stdout.split('\n').filter((line) => line.trim().length > 0)
  return JSON.parse(lines[lines.length - 1] ?? 'null')
}

describe('inngest commands', () => {
  beforeEach(() => {
    process.exitCode = undefined
    mockListEvents.mockReset()
    mockGetEvent.mockReset()
    mockGetEventRuns.mockReset()
    mockGetRun.mockReset()
    mockSendSignal.mockReset()
    mockReplayEvent.mockReset()
    mockDetectDevServer.mockClear()
    mockParseTimeArg.mockClear()
  })

  it('events list outputs JSON payload', async () => {
    mockListEvents.mockResolvedValue({
      data: [
        {
          internal_id: 'evt_1',
          name: 'test.event',
          data: { ok: true },
          received_at: '2025-01-01T00:00:00Z',
        },
      ],
      cursor: undefined,
    })

    const { ctx, getStdout } = await createTestContext({ format: 'json' })

    await listEvents(ctx, { json: true })

    const payload = parseLastJson(getStdout()) as unknown[]
    expect(Array.isArray(payload)).toBe(true)
    expect(payload).toHaveLength(1)
  })

  it('events list reports errors', async () => {
    mockListEvents.mockRejectedValue(new Error('boom'))

    const { ctx, getStderr } = await createTestContext({ format: 'json' })

    await listEvents(ctx, { json: true })

    const errorOutput = getStderr()
    expect(errorOutput).toContain('Failed to list Inngest events.')
    expect(errorOutput).toContain('Suggestion:')
    expect(process.exitCode).toBe(1)
  })

  it('event outputs JSON payload', async () => {
    mockGetEvent.mockResolvedValue({
      internal_id: 'evt_1',
      name: 'test.event',
      data: { ok: true },
      received_at: '2025-01-01T00:00:00Z',
    })
    mockGetEventRuns.mockResolvedValue([
      {
        run_id: 'run_1',
        function_id: 'fn_1',
        status: 'Completed',
        run_started_at: '2025-01-01T00:00:00Z',
        ended_at: '2025-01-01T00:00:01Z',
        output: { ok: true },
        event_id: 'evt_1',
      },
    ])

    const { ctx, getStdout } = await createTestContext({ format: 'json' })

    await getEvent(ctx, 'evt_1', { json: true })

    const payload = parseLastJson(getStdout()) as {
      event: { internal_id: string }
      runs: unknown[]
    }
    expect(payload.event.internal_id).toBe('evt_1')
    expect(payload.runs).toHaveLength(1)
  })

  it('event reports errors', async () => {
    mockGetEvent.mockRejectedValue(new Error('missing'))

    const { ctx, getStderr } = await createTestContext({ format: 'json' })

    await getEvent(ctx, 'evt_1', { json: true })

    const errorOutput = getStderr()
    expect(errorOutput).toContain('Failed to fetch Inngest event.')
    expect(errorOutput).toContain('Suggestion:')
    expect(process.exitCode).toBe(1)
  })

  it('run outputs JSON payload', async () => {
    mockGetRun.mockResolvedValue({
      run_id: 'run_1',
      function_id: 'fn_1',
      status: 'Completed',
      run_started_at: '2025-01-01T00:00:00Z',
      ended_at: '2025-01-01T00:00:01Z',
      output: { ok: true },
      event_id: 'evt_1',
    })

    const { ctx, getStdout } = await createTestContext({ format: 'json' })

    await runCommand(ctx, 'run_1', { json: true })

    const payload = parseLastJson(getStdout()) as { run_id: string }
    expect(payload.run_id).toBe('run_1')
  })

  it('run reports errors', async () => {
    mockGetRun.mockRejectedValue(new Error('nope'))

    const { ctx, getStderr } = await createTestContext({ format: 'json' })

    await runCommand(ctx, 'run_1', { json: true })

    const errorOutput = getStderr()
    expect(errorOutput).toContain('Failed to fetch Inngest run.')
    expect(errorOutput).toContain('Suggestion:')
    expect(process.exitCode).toBe(1)
  })

  it('signal outputs JSON payload', async () => {
    mockSendSignal.mockResolvedValue({ run_id: 'run_1', message: 'ok' })

    const { ctx, getStdout } = await createTestContext({ format: 'json' })

    await signalCommand(ctx, 'approval:1', {
      data: '{"approved": true}',
      json: true,
    })

    const payload = parseLastJson(getStdout()) as {
      success: boolean
      signal: string
    }
    expect(payload.success).toBe(true)
    expect(payload.signal).toBe('approval:1')
  })

  it('signal reports errors', async () => {
    mockSendSignal.mockRejectedValue(new Error('signal failed'))

    const { ctx, getStderr } = await createTestContext({ format: 'json' })

    await signalCommand(ctx, 'approval:1', {
      data: '{"approved": true}',
      json: true,
    })

    const errorOutput = getStderr()
    expect(errorOutput).toContain('signal failed')
    expect(errorOutput).toContain('Suggestion:')
    expect(process.exitCode).toBe(1)
  })

  it('inspect outputs JSON payload', async () => {
    mockGetEvent.mockResolvedValue({
      internal_id: 'evt_1',
      name: 'test.event',
      data: { ok: true },
      received_at: '2025-01-01T00:00:00Z',
    })
    mockGetEventRuns.mockResolvedValue([
      {
        run_id: 'run_1',
        function_id: 'fn_1',
        status: 'Completed',
        run_started_at: '2025-01-01T00:00:00Z',
        ended_at: '2025-01-01T00:00:01Z',
        output: { ok: true },
        event_id: 'evt_1',
      },
    ])
    mockListEvents.mockResolvedValue({
      data: [
        {
          internal_id: 'evt_finished',
          name: 'inngest/function.finished',
          data: { run_id: 'run_1', result: { ok: true } },
          received_at: '2025-01-01T00:00:02Z',
        },
      ],
    })

    const { ctx, getStdout } = await createTestContext({ format: 'json' })

    await inspect(ctx, 'evt_1', { json: true })

    const payload = parseLastJson(getStdout()) as {
      event_id: string
      runs: unknown[]
    }
    expect(payload.event_id).toBe('evt_1')
    expect(payload.runs).toHaveLength(1)
  })

  it('inspect reports errors', async () => {
    mockGetEvent.mockRejectedValue(new Error('bad'))

    const { ctx, getStderr } = await createTestContext({ format: 'json' })

    await inspect(ctx, 'evt_1', { json: true })

    const errorOutput = getStderr()
    expect(errorOutput).toContain('Failed to inspect Inngest event.')
    expect(errorOutput).toContain('Suggestion:')
    expect(process.exitCode).toBe(1)
  })

  it('failures outputs JSON payload', async () => {
    mockListEvents.mockResolvedValue({
      data: [
        {
          internal_id: 'evt_1',
          name: 'inngest/function.finished',
          data: {
            run_id: 'run_1',
            function_id: 'fn_1',
            error: { message: 'oops' },
          },
          received_at: '2025-01-01T00:00:00Z',
        },
      ],
    })

    const { ctx, getStdout } = await createTestContext({ format: 'json' })

    await failures(ctx, { json: true })

    const payload = parseLastJson(getStdout()) as { failures: unknown[] }
    expect(payload.failures).toHaveLength(1)
  })

  it('failures reports errors', async () => {
    mockListEvents.mockRejectedValue(new Error('no data'))

    const { ctx, getStderr } = await createTestContext({ format: 'json' })

    await failures(ctx, { json: true })

    const errorOutput = getStderr()
    expect(errorOutput).toContain('Failed to aggregate Inngest failures.')
    expect(errorOutput).toContain('Suggestion:')
    expect(process.exitCode).toBe(1)
  })

  it('stats outputs JSON payload', async () => {
    mockListEvents.mockResolvedValue({
      data: [
        {
          internal_id: 'evt_1',
          name: 'inngest/function.finished',
          data: {
            result: { skipped: true, classification: { category: 'noise' } },
          },
          received_at: '2025-01-01T00:00:00Z',
        },
      ],
    })

    const { ctx, getStdout } = await createTestContext({ format: 'json' })

    await stats(ctx, { json: true })

    const payload = parseLastJson(getStdout()) as { total_events: number }
    expect(payload.total_events).toBe(1)
  })

  it('stats reports errors', async () => {
    mockListEvents.mockRejectedValue(new Error('fail'))

    const { ctx, getStderr } = await createTestContext({ format: 'json' })

    await stats(ctx, { json: true })

    const errorOutput = getStderr()
    expect(errorOutput).toContain('Failed to compute Inngest stats.')
    expect(errorOutput).toContain('Suggestion:')
    expect(process.exitCode).toBe(1)
  })

  it('search outputs JSON payload', async () => {
    mockListEvents.mockResolvedValue({
      data: [
        {
          internal_id: 'evt_1',
          name: 'test.event',
          data: { email: 'user@example.com' },
          received_at: '2025-01-01T00:00:00Z',
        },
      ],
    })

    const { ctx, getStdout } = await createTestContext({ format: 'json' })

    await search(ctx, 'user@example.com', { field: 'email' })

    const payload = parseLastJson(getStdout()) as { matches_found: number }
    expect(payload.matches_found).toBe(1)
  })

  it('search reports errors', async () => {
    mockListEvents.mockRejectedValue(new Error('boom'))

    const { ctx, getStderr } = await createTestContext({ format: 'json' })

    await search(ctx, 'user@example.com', { field: 'email' })

    const errorOutput = getStderr()
    expect(errorOutput).toContain('Failed to search Inngest events.')
    expect(errorOutput).toContain('Suggestion:')
    expect(process.exitCode).toBe(1)
  })
})
