import { PassThrough } from 'node:stream'
import { type CommandContext, createContext } from '../../src/core/context'

type TestContextResult = {
  ctx: CommandContext
  getStdout: () => string
  getStderr: () => string
}

export function createTestContext(
  overrides: Partial<CommandContext> = {}
): TestContextResult {
  const stdout = new PassThrough() as NodeJS.WriteStream
  const stderr = new PassThrough() as NodeJS.WriteStream

  let stdoutBuffer = ''
  let stderrBuffer = ''

  stdout.on('data', (chunk) => {
    stdoutBuffer += chunk.toString()
  })

  stderr.on('data', (chunk) => {
    stderrBuffer += chunk.toString()
  })

  const controller = new AbortController()

  const secrets = {
    name: 'test-secrets',
    async isAvailable() {
      return true
    },
    async resolve() {
      return 'test-secret'
    },
    async resolveAll() {
      return { TEST_SECRET: 'test-secret' }
    },
  }

  const ctx = createContext({
    stdout,
    stderr,
    signal: controller.signal,
    secrets,
    ...overrides,
  })

  return {
    ctx,
    getStdout: () => stdoutBuffer,
    getStderr: () => stderrBuffer,
  }
}
