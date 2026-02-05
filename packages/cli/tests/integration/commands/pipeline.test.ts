import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runPipelineCommand } from '../../../src/commands/pipeline'
import { createTestContext } from '../../helpers/test-context'

vi.mock('@skillrecordings/core/pipeline', () => ({
  runPipeline: vi.fn(),
}))

const parseLastJson = (stdout: string) => {
  const lines = stdout.split('\n').filter((line) => line.trim().length > 0)
  return JSON.parse(lines[lines.length - 1] ?? 'null')
}

describe('pipeline commands', () => {
  beforeEach(() => {
    process.exitCode = undefined
    vi.clearAllMocks()
  })

  it('run outputs JSON payload', async () => {
    const { runPipeline } = await import('@skillrecordings/core/pipeline')
    vi.mocked(runPipeline).mockResolvedValue({
      action: 'reply',
      response: 'ok',
      steps: [{ step: 'classify', success: true, durationMs: 10 }],
      totalDurationMs: 10,
    })

    const { ctx, getStdout } = await createTestContext({ format: 'json' })

    await runPipelineCommand(ctx, {
      subject: 'hello',
      body: 'world',
      app: 'total-typescript',
      dryRun: true,
      json: true,
    })

    const payload = parseLastJson(getStdout()) as { action: string }
    expect(payload.action).toBe('reply')
  })
})
