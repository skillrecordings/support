import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SECRET_REFS } from '../../../src/core/secret-refs'
import { createTestContext } from '../../helpers/test-context'

const mockCreateSecretsProvider = vi.hoisted(() => vi.fn())
const mockIsAvailable = vi.hoisted(() => vi.fn())
const mockResolve = vi.hoisted(() => vi.fn())

const MockOnePasswordProvider = vi.hoisted(
  () =>
    class {
      name = '1password'
      isAvailable = mockIsAvailable
      resolve = mockResolve
      resolveAll = async () => ({})
    }
)

vi.mock('../../../src/core/secrets', () => ({
  createSecretsProvider: mockCreateSecretsProvider,
  OnePasswordProvider: MockOnePasswordProvider,
}))

import { loginAction } from '../../../src/commands/auth/login'
import { statusAction } from '../../../src/commands/auth/status'
import { whoamiAction } from '../../../src/commands/auth/whoami'

const base64UrlEncode = (value: string): string =>
  Buffer.from(value)
    .toString('base64')
    .replace(/=+$/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')

const buildJwt = (payload: Record<string, unknown>): string => {
  const header = base64UrlEncode(JSON.stringify({ typ: 'JWT', alg: 'HS256' }))
  const body = base64UrlEncode(JSON.stringify(payload))
  return `${header}.${body}.signature`
}

describe('auth commands', () => {
  beforeEach(() => {
    mockCreateSecretsProvider.mockReset()
    mockIsAvailable.mockReset()
    mockResolve.mockReset()
    delete process.env.OP_SERVICE_ACCOUNT_TOKEN
    delete process.env.DATABASE_URL
    process.exitCode = undefined
  })

  afterEach(() => {})

  it('auth status reports active provider and secrets', async () => {
    mockCreateSecretsProvider.mockResolvedValue({
      name: 'env',
      isAvailable: vi.fn(async () => true),
      resolve: vi.fn(async () => 'value'),
      resolveAll: vi.fn(async () => ({})),
    })

    process.env.DATABASE_URL = 'postgres://test'

    const { ctx, getStdout, getStderr } = await createTestContext({
      format: 'json',
    })

    await statusAction(ctx, { json: true })

    expect(mockCreateSecretsProvider).toHaveBeenCalledTimes(1)
    expect(getStderr()).toBe('')

    const payload = JSON.parse(getStdout()) as {
      activeProvider: string
      availableSecrets: string[]
      missingSecrets: string[]
    }

    expect(payload.activeProvider).toBe('env')
    expect(payload.availableSecrets).toContain('DATABASE_URL')
    expect(payload.missingSecrets.length).toBeGreaterThan(0)
    expect(
      payload.availableSecrets.length + payload.missingSecrets.length
    ).toBe(Object.keys(SECRET_REFS).length)
  })

  it('auth login validates a provided token', async () => {
    mockIsAvailable.mockResolvedValue(true)

    const { ctx, getStdout, getStderr } = await createTestContext({
      format: 'json',
    })

    await loginAction(ctx, { token: 'op_token', json: true })

    expect(mockIsAvailable).toHaveBeenCalledTimes(1)
    expect(process.env.OP_SERVICE_ACCOUNT_TOKEN).toBe('op_token')
    expect(getStderr()).toBe('')

    const payload = JSON.parse(getStdout()) as {
      success: boolean
      provider: string
      tokenConfigured: boolean
    }

    expect(payload.success).toBe(true)
    expect(payload.provider).toBe('1password')
    expect(payload.tokenConfigured).toBe(true)
  })

  it('auth whoami returns token details', async () => {
    mockIsAvailable.mockResolvedValue(true)

    const token = buildJwt({
      sub: 'service-account',
      iat: 1710000000,
      exp: 1910000000,
    })

    process.env.OP_SERVICE_ACCOUNT_TOKEN = token

    const { ctx, getStdout, getStderr } = await createTestContext({
      format: 'json',
    })

    await whoamiAction(ctx, { json: true })
    expect(getStderr()).toBe('')

    const payload = JSON.parse(getStdout()) as {
      success: boolean
      tokenConfigured: boolean
      token?: {
        format: string
        fingerprint: string
        claims?: Record<string, unknown>
      }
    }

    expect(payload.success).toBe(true)
    expect(payload.tokenConfigured).toBe(true)
    expect(payload.token?.format).toBe('jwt')
    expect(payload.token?.fingerprint).toHaveLength(12)
    expect(payload.token?.claims?.sub).toBe('service-account')
  })
})
