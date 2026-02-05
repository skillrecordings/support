import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { init } from '../../../src/commands/init'
import { createTestContext } from '../../helpers/test-context'

const parseLastJson = (stdout: string) => {
  const lines = stdout.split('\n').filter((line) => line.trim().length > 0)
  return JSON.parse(lines[lines.length - 1] ?? 'null')
}

describe('init command', () => {
  it('outputs JSON result when name provided', async () => {
    const { ctx, getStdout } = await createTestContext({ format: 'json' })

    await init(ctx, 'My App', { json: true })

    const payload = parseLastJson(getStdout()) as { appName: string }
    expect(payload.appName).toBe('My App')
  })

  it('requires name in non-interactive mode', async () => {
    const stdin = new PassThrough() as unknown as NodeJS.ReadStream
    stdin.isTTY = false
    const { ctx, getStderr } = await createTestContext({
      format: 'json',
      stdin,
    })

    await init(ctx, undefined, { json: true })

    expect(getStderr()).toContain(
      'App name is required in non-interactive mode'
    )
  })
})
