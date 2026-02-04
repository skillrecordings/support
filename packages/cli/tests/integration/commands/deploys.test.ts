import { beforeEach, describe, expect, it, vi } from 'vitest'
import { deploysStatus } from '../../../src/commands/deploys'
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
})
