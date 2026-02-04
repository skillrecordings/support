import * as fs from 'node:fs/promises'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runEval } from '../../../src/commands/eval'
import { createTestContext } from '../../helpers/test-context'

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  access: vi.fn(),
}))

vi.mock('@skillrecordings/core/evals/routing', () => ({
  evalRouting: vi.fn(),
}))

const parseLastJson = (stdout: string) => {
  const lines = stdout.split('\n').filter((line) => line.trim().length > 0)
  return JSON.parse(lines[lines.length - 1] ?? 'null')
}

describe('eval commands', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
  })

  it('outputs JSON report', async () => {
    vi.mocked(fs.access).mockResolvedValue(undefined)
    vi.mocked(fs.readFile).mockResolvedValue('[]')

    const { evalRouting } = await import('@skillrecordings/core/evals/routing')
    vi.mocked(evalRouting).mockResolvedValue({
      precision: 1,
      recall: 1,
      fpRate: 0,
      fnRate: 0,
      byCategory: {},
      cost: { tokens: 10, estimatedUsd: 0.001 },
      latency: { p50: 10, p95: 20, p99: 30 },
      passed: true,
    })

    const { ctx, getStdout } = await createTestContext({ format: 'json' })

    await runEval(ctx, 'routing', '/tmp/dataset.json', { json: true })

    const payload = parseLastJson(getStdout()) as { precision: number }
    expect(payload.precision).toBe(1)
  })
})
