import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { createContext } from '../../../src/core/context'
import { type SecretsProvider } from '../../../src/core/secrets'

describe('createContext', () => {
  it('provides defaults', () => {
    const context = createContext()

    expect(context.stdin).toBe(process.stdin)
    expect(context.stdout).toBe(process.stdout)
    expect(context.stderr).toBe(process.stderr)
    expect(context.config).toEqual({})
    expect(context.format).toBe('text')
    expect(context.signal.aborted).toBe(false)
    expect(context.secrets.name).toBe('none')
    expect(typeof context.onCleanup).toBe('function')
  })

  it('accepts overrides', () => {
    const stdin = new PassThrough() as NodeJS.ReadStream
    const stdout = new PassThrough() as NodeJS.WriteStream
    const stderr = new PassThrough() as NodeJS.WriteStream
    const signal = new AbortController().signal
    const onCleanup = vi.fn()
    const secrets: SecretsProvider = {
      name: 'test',
      async isAvailable() {
        return true
      },
      async resolve() {
        return 'secret'
      },
      async resolveAll() {
        return { TEST: 'secret' }
      },
    }

    const context = createContext({
      stdin,
      stdout,
      stderr,
      config: { env: 'test' },
      signal,
      secrets,
      format: 'json',
      onCleanup,
    })

    expect(context.stdin).toBe(stdin)
    expect(context.stdout).toBe(stdout)
    expect(context.stderr).toBe(stderr)
    expect(context.config).toEqual({ env: 'test' })
    expect(context.signal).toBe(signal)
    expect(context.secrets).toBe(secrets)
    expect(context.format).toBe('json')
    expect(context.onCleanup).toBe(onCleanup)
  })
})
