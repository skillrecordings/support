import * as fs from 'node:fs/promises'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestContext } from '../../tests/helpers/test-context'
import { runEval } from './eval'

// Mock fs module
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  access: vi.fn(),
}))

// Mock core evals module
vi.mock('@skillrecordings/core/evals/routing', () => ({
  evalRouting: vi.fn(),
}))

const parseLastJson = (stdout: string) => {
  const lines = stdout.split('\n').filter((line) => line.trim().length > 0)
  return JSON.parse(lines[lines.length - 1] ?? 'null')
}

describe('eval command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
  })

  it('should require dataset path', async () => {
    const { ctx, getStderr } = await createTestContext({ format: 'json' })

    await runEval(ctx, 'routing', undefined)

    expect(getStderr()).toContain('Dataset path is required')
    expect(process.exitCode).toBe(1)
  })

  it('should fail if dataset file does not exist', async () => {
    vi.mocked(fs.access).mockRejectedValue(new Error('File not found'))
    const { ctx, getStderr } = await createTestContext({ format: 'json' })

    await runEval(ctx, 'routing', '/path/to/nonexistent.json')

    expect(getStderr()).toContain('Dataset file not found')
    expect(process.exitCode).toBe(1)
  })

  it('should fail if dataset is invalid JSON', async () => {
    vi.mocked(fs.access).mockResolvedValue(undefined)
    vi.mocked(fs.readFile).mockResolvedValue('invalid json')
    const { ctx, getStderr } = await createTestContext({ format: 'json' })

    await runEval(ctx, 'routing', '/path/to/invalid.json')

    expect(getStderr()).toContain('Invalid JSON')
    expect(process.exitCode).toBe(1)
  })

  it('should print pretty results table by default', async () => {
    const mockDataset = [
      {
        message: 'Test message',
        expectedCategory: 'needs_response',
        expectedRoute: 'classifier' as const,
      },
    ]
    const mockReport = {
      precision: 0.92,
      recall: 0.95,
      fpRate: 0.03,
      fnRate: 0.02,
      byCategory: {
        needs_response: {
          tp: 10,
          fp: 1,
          fn: 1,
          tn: 5,
          precision: 0.95,
          recall: 0.93,
          f1: 0.94,
          count: 17,
        },
      },
      cost: {
        tokens: 5000,
        estimatedUsd: 0.00125,
      },
      latency: {
        p50: 120,
        p95: 250,
        p99: 350,
      },
      passed: true,
    }

    vi.mocked(fs.access).mockResolvedValue(undefined)
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockDataset))

    const { evalRouting } = await import('@skillrecordings/core/evals/routing')
    vi.mocked(evalRouting).mockResolvedValue(mockReport)

    const { ctx, getStdout } = await createTestContext({ format: 'text' })

    await runEval(ctx, 'routing', '/path/to/dataset.json')

    const output = getStdout()
    expect(output).toContain('Precision')
    expect(output).toContain('92.0%')
    expect(output).toContain('Recall')
    expect(output).toContain('95.0%')
    expect(output).toContain('Latency')
    expect(output).toContain('120ms')
  })

  it('should output JSON when --json flag is used', async () => {
    const mockDataset = [
      {
        message: 'Test message',
        expectedCategory: 'needs_response',
        expectedRoute: 'classifier' as const,
      },
    ]
    const mockReport = {
      precision: 0.92,
      recall: 0.95,
      fpRate: 0.03,
      fnRate: 0.02,
      byCategory: {},
      cost: {
        tokens: 5000,
        estimatedUsd: 0.00125,
      },
      latency: {
        p50: 120,
        p95: 250,
        p99: 350,
      },
      passed: true,
    }

    vi.mocked(fs.access).mockResolvedValue(undefined)
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockDataset))

    const { evalRouting } = await import('@skillrecordings/core/evals/routing')
    vi.mocked(evalRouting).mockResolvedValue(mockReport)

    const { ctx, getStdout, getStderr } = await createTestContext({
      format: 'json',
    })

    await runEval(ctx, 'routing', '/path/to/dataset.json', { json: true })

    const parsed = parseLastJson(getStdout())

    expect(parsed.precision).toBe(0.92)
    expect(parsed.recall).toBe(0.95)
    expect(parsed.passed).toBe(true)
    expect(getStderr()).toBe('')
  })

  it('should exit with code 1 when gates fail', async () => {
    const mockDataset = [
      {
        message: 'Test message',
        expectedCategory: 'needs_response',
        expectedRoute: 'classifier' as const,
      },
    ]
    const mockReport = {
      precision: 0.85, // Below threshold
      recall: 0.88, // Below threshold
      fpRate: 0.05,
      fnRate: 0.04,
      byCategory: {},
      cost: {
        tokens: 5000,
        estimatedUsd: 0.00125,
      },
      latency: {
        p50: 120,
        p95: 250,
        p99: 350,
      },
      passed: false,
    }

    vi.mocked(fs.access).mockResolvedValue(undefined)
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockDataset))

    const { evalRouting } = await import('@skillrecordings/core/evals/routing')
    vi.mocked(evalRouting).mockResolvedValue(mockReport)

    const { ctx } = await createTestContext({ format: 'json' })

    await runEval(ctx, 'routing', '/path/to/dataset.json', {
      gates: { minPrecision: 0.92, minRecall: 0.95 },
    })

    expect(process.exitCode).toBe(1)
  })

  it('should accept custom gates', async () => {
    const mockDataset = [
      {
        message: 'Test message',
        expectedCategory: 'needs_response',
        expectedRoute: 'classifier' as const,
      },
    ]
    const mockReport = {
      precision: 0.92,
      recall: 0.95,
      fpRate: 0.03,
      fnRate: 0.02,
      byCategory: {},
      cost: {
        tokens: 5000,
        estimatedUsd: 0.00125,
      },
      latency: {
        p50: 120,
        p95: 250,
        p99: 350,
      },
      passed: true,
    }

    vi.mocked(fs.access).mockResolvedValue(undefined)
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockDataset))

    const { evalRouting } = await import('@skillrecordings/core/evals/routing')
    vi.mocked(evalRouting).mockResolvedValue(mockReport)

    // Test with custom gates
    const { ctx } = await createTestContext({ format: 'json' })

    await runEval(ctx, 'routing', '/path/to/dataset.json', {
      gates: { minPrecision: 0.9, minRecall: 0.93, maxFpRate: 0.05 },
    })

    expect(evalRouting).toHaveBeenCalledWith(mockDataset, {
      minPrecision: 0.9,
      minRecall: 0.93,
      maxFpRate: 0.05,
    })
  })
})
