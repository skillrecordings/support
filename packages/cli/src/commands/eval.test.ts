import * as fs from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runEval } from './eval'

// Mock process.exit to prevent test termination
const mockExit = vi.spyOn(process, 'exit').mockImplementation((code) => {
  throw new Error(`process.exit(${code})`)
})

// Mock fs module
vi.mock('node:fs/promises')

// Mock core evals module
vi.mock('@skillrecordings/core/evals/routing', () => ({
  evalRouting: vi.fn(),
}))

describe('eval command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockExit.mockClear()
  })

  afterEach(() => {
    mockExit.mockClear()
  })

  it('should require dataset path', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error')

    await expect(runEval('routing', undefined)).rejects.toThrow(
      'process.exit(1)'
    )

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Dataset path is required')
    )
  })

  it('should fail if dataset file does not exist', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error')
    vi.mocked(fs.access).mockRejectedValue(new Error('File not found'))

    await expect(
      runEval('routing', '/path/to/nonexistent.json')
    ).rejects.toThrow('process.exit(1)')

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Dataset file not found')
    )
  })

  it('should fail if dataset is invalid JSON', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error')
    vi.mocked(fs.access).mockResolvedValue(undefined)
    vi.mocked(fs.readFile).mockResolvedValue('invalid json')

    await expect(runEval('routing', '/path/to/invalid.json')).rejects.toThrow(
      'process.exit(1)'
    )

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Invalid JSON')
    )
  })

  it('should print pretty results table by default', async () => {
    const consoleSpy = vi.spyOn(console, 'log')
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

    await expect(runEval('routing', '/path/to/dataset.json')).rejects.toThrow(
      'process.exit(0)'
    )

    const output = consoleSpy.mock.calls.flat().join('\n')
    expect(output).toContain('Precision')
    expect(output).toContain('92.0%')
    expect(output).toContain('Recall')
    expect(output).toContain('95.0%')
    expect(output).toContain('Latency')
    expect(output).toContain('120ms')
  })

  it('should output JSON when --json flag is used', async () => {
    const consoleSpy = vi.spyOn(console, 'log')
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

    await expect(
      runEval('routing', '/path/to/dataset.json', { json: true })
    ).rejects.toThrow('process.exit(0)')

    const output = consoleSpy.mock.calls.flat().join('\n')
    const parsed = JSON.parse(output)

    expect(parsed.precision).toBe(0.92)
    expect(parsed.recall).toBe(0.95)
    expect(parsed.passed).toBe(true)
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

    await expect(
      runEval('routing', '/path/to/dataset.json', {
        gates: { minPrecision: 0.92, minRecall: 0.95 },
      })
    ).rejects.toThrow('process.exit(1)')
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
    await expect(
      runEval('routing', '/path/to/dataset.json', {
        gates: { minPrecision: 0.9, minRecall: 0.93, maxFpRate: 0.05 },
      })
    ).rejects.toThrow('process.exit(0)')

    expect(evalRouting).toHaveBeenCalledWith(mockDataset, {
      minPrecision: 0.9,
      minRecall: 0.93,
      maxFpRate: 0.05,
    })
  })
})
