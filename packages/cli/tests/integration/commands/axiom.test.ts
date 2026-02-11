import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestContext } from '../../helpers/test-context'

const mockQuery = vi.hoisted(() => vi.fn())
const mockGetAxiomClient = vi.hoisted(() => vi.fn(() => ({ query: mockQuery })))
const mockParseTimeRange = vi.hoisted(() =>
  vi.fn(() => ({
    startTime: new Date('2024-01-01T00:00:00Z'),
    endTime: new Date('2024-01-02T00:00:00Z'),
  }))
)
const mockGetDataset = vi.hoisted(() => vi.fn(() => 'test-ds'))
const mockFormatDuration = vi.hoisted(() => vi.fn((ms: number) => `${ms}ms`))
const mockFormatTime = vi.hoisted(() => vi.fn(() => 'Jan 01 00:00:00'))

vi.mock('../../../src/lib/axiom-client', () => ({
  getAxiomClient: mockGetAxiomClient,
  parseTimeRange: mockParseTimeRange,
  getDataset: mockGetDataset,
  formatDuration: mockFormatDuration,
  formatTime: mockFormatTime,
}))

import { pipelineHealth } from '../../../src/commands/axiom/forensic'
import { listErrors, runQuery } from '../../../src/commands/axiom/index'

const parseLastJson = (stdout: string) => {
  const lines = stdout.split('\n').filter((line) => line.trim().length > 0)
  return JSON.parse(lines[lines.length - 1] ?? 'null')
}

describe('axiom commands', () => {
  beforeEach(() => {
    mockQuery.mockReset()
    mockGetAxiomClient.mockClear()
    mockParseTimeRange.mockClear()
    mockGetDataset.mockClear()
    mockFormatDuration.mockClear()
    mockFormatTime.mockClear()
    process.exitCode = undefined
  })

  it('runQuery outputs JSON payload', async () => {
    mockQuery.mockResolvedValueOnce({
      matches: [{ _time: '2024-01-01T00:00:00Z', data: { foo: 'bar' } }],
      status: { elapsedTime: 12 },
    })

    const { ctx, getStdout, getStderr } = await createTestContext({
      format: 'json',
    })

    await runQuery(ctx, "['support-traces'] | limit 1", {
      since: '1h',
      json: true,
    })

    expect(getStderr()).toBe('')
    const payload = parseLastJson(getStdout()) as {
      matches: Array<{ data: { foo: string } }>
    }
    expect(payload.matches[0]?.data.foo).toBe('bar')
  })

  it('pipelineHealth outputs JSON payload', async () => {
    mockQuery
      .mockResolvedValueOnce({
        buckets: { totals: [{ aggregations: [{ value: 120 }] }] },
      })
      .mockResolvedValueOnce({
        buckets: { totals: [{ aggregations: [{ value: 5 }, { value: 100 }] }] },
      })
      .mockResolvedValueOnce({
        buckets: {
          totals: [
            {
              aggregations: [{ value: 1000 }, { value: 900 }, { value: 2000 }],
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        buckets: {
          totals: [{ aggregations: [{ value: 90 }, { value: 100 }] }],
        },
      })
      .mockResolvedValueOnce({
        buckets: {
          totals: [{ aggregations: [{ value: 80 }, { value: 100 }] }],
        },
      })
      .mockResolvedValueOnce({
        buckets: {
          totals: [{ group: { name: 'step-a' }, aggregations: [{ value: 3 }] }],
        },
      })

    const { ctx, getStdout } = await createTestContext({ format: 'json' })

    await pipelineHealth(ctx, { json: true, since: '7d' })

    const payload = parseLastJson(getStdout()) as {
      totalProcessed: number
      errors: { count: number; rate: number }
      duration: { avg: number; p50: number; p95: number }
      tags: { success: number; total: number }
      approval: { auto: number; total: number }
      topErrors: Array<{ name: string; count: number }>
    }
    expect(payload.totalProcessed).toBe(120)
    expect(payload.errors.count).toBe(5)
    expect(payload.duration.p95).toBe(2000)
    expect(payload.tags.total).toBe(100)
    expect(payload.approval.auto).toBe(80)
    expect(payload.topErrors[0]?.name).toBe('step-a')
  })

  it('listErrors reports errors', async () => {
    mockQuery.mockRejectedValueOnce(new Error('boom'))

    const { ctx, getStderr } = await createTestContext({ format: 'json' })

    await listErrors(ctx, { json: true })

    const errorOutput = getStderr()
    expect(errorOutput).toContain('Failed to list recent errors.')
    expect(errorOutput).toContain('Suggestion:')
    expect(process.exitCode).toBe(1)
  })

  it('listErrors JSON filters out non-error rows', async () => {
    mockQuery.mockResolvedValueOnce({
      matches: [
        {
          _time: '2024-01-01T00:00:00Z',
          data: { status: 'success', level: 'info', message: 'ok' },
        },
        {
          _time: '2024-01-01T00:00:01Z',
          data: { status: 'error', message: 'failed step' },
        },
        {
          _time: '2024-01-01T00:00:02Z',
          data: { level: 'error', name: 'workflow.run' },
        },
        {
          _time: '2024-01-01T00:00:03Z',
          data: { error: 'Unexpected end of JSON input' },
        },
      ],
      status: { elapsedTime: 12 },
    })

    const { ctx, getStdout, getStderr } = await createTestContext({
      format: 'json',
    })

    await listErrors(ctx, { json: true, limit: 10 })

    expect(getStderr()).toBe('')
    const payload = parseLastJson(getStdout()) as Array<Record<string, unknown>>
    expect(payload).toHaveLength(3)
    expect(payload).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: 'error' }),
        expect.objectContaining({ level: 'error' }),
        expect.objectContaining({ error: 'Unexpected end of JSON input' }),
      ])
    )
  })
})
