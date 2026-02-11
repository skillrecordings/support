import { beforeEach, describe, expect, it, vi } from 'vitest'
import { deploysLogs, deploysStatus } from '../../../src/commands/deploys'
import { createTestContext } from '../../helpers/test-context'

const mockExecSync = vi.fn()

vi.mock('child_process', () => ({
  execSync: (cmd: string, opts: unknown) => mockExecSync(cmd, opts),
}))

const parseLastJson = (stdout: string) => {
  const lines = stdout.split('\n').filter((line) => line.trim().length > 0)
  return JSON.parse(lines[lines.length - 1] ?? 'null')
}

describe('deploys commands', () => {
  beforeEach(() => {
    process.exitCode = undefined
    mockExecSync.mockReset()
  })

  it('status outputs JSON payload', async () => {
    mockExecSync.mockReturnValue(
      [
        'Age  URL                          Status',
        '1m   https://front.vercel.app     Ready Production',
        '2m   https://front-prev.vercel.app Ready Preview',
      ].join('\n')
    )

    const { ctx, getStdout } = await createTestContext({ format: 'json' })

    await deploysStatus(ctx, 'front', { json: true, limit: '2' })

    const payload = parseLastJson(getStdout()) as Array<{ status: string[] }>
    expect(payload[0]?.status.length).toBeGreaterThan(0)
  })

  it('logs uses historical mode with limit/since flags', async () => {
    mockExecSync
      .mockReturnValueOnce(
        [
          'Age  URL                          Status',
          '1m   https://front.vercel.app     Ready Production',
        ].join('\n')
      )
      .mockReturnValueOnce('{"message":"ok"}')

    const { ctx, getStdout } = await createTestContext({ format: 'json' })

    await deploysLogs(ctx, 'front', { json: true, lines: '7', since: '1h' })

    const payload = parseLastJson(getStdout()) as {
      deployment: string
      logs: string
    }
    expect(payload.deployment).toBe('https://front.vercel.app')
    expect(payload.logs).toContain('"message":"ok"')

    const firstCall = mockExecSync.mock.calls[0]?.[0] as string
    expect(firstCall).toContain('vercel ls skill-support-agent-front')
    expect(firstCall).not.toContain('--limit')

    const secondCall = mockExecSync.mock.calls[1]?.[0] as string
    expect(secondCall).toContain('vercel logs https://front.vercel.app')
    expect(secondCall).toContain('--no-follow')
    expect(secondCall).toContain('--limit 7')
    expect(secondCall).toContain('--since 1h')
    expect(secondCall).toContain('--json')
    expect(secondCall).toContain('--non-interactive')
  })
})
