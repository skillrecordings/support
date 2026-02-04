import { createClient } from '@1password/sdk'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SECRET_REFS } from '../../../src/core/secret-refs'
import {
  EnvProvider,
  OnePasswordProvider,
  createSecretsProvider,
} from '../../../src/core/secrets'

vi.mock(
  '@1password/sdk',
  () => ({
    createClient: vi.fn(),
  }),
  { virtual: true }
)

describe('SecretsProvider', () => {
  beforeEach(() => {
    vi.mocked(createClient).mockReset()
    delete process.env.OP_SERVICE_ACCOUNT_TOKEN
    delete process.env.AGE_SECRET_KEY
  })

  it('resolves secrets with 1Password and caches results', async () => {
    process.env.OP_SERVICE_ACCOUNT_TOKEN = 'token'

    const resolve = vi.fn().mockResolvedValue('shh')
    vi.mocked(createClient).mockResolvedValue({
      secrets: {
        resolve,
        resolveAll: vi.fn().mockResolvedValue({
          [SECRET_REFS.AGE_SECRET_KEY]: 'shh',
        }),
      },
    })

    const provider = new OnePasswordProvider()

    await expect(provider.resolve(SECRET_REFS.AGE_SECRET_KEY)).resolves.toBe(
      'shh'
    )
    await expect(provider.resolve(SECRET_REFS.AGE_SECRET_KEY)).resolves.toBe(
      'shh'
    )

    expect(resolve).toHaveBeenCalledTimes(1)
  })

  it('throws when 1Password cannot resolve a secret', async () => {
    process.env.OP_SERVICE_ACCOUNT_TOKEN = 'token'

    vi.mocked(createClient).mockResolvedValue({
      secrets: {
        resolve: vi.fn().mockRejectedValue(new Error('missing secret')),
      },
    })

    const provider = new OnePasswordProvider()

    await expect(provider.resolve(SECRET_REFS.AGE_SECRET_KEY)).rejects.toThrow(
      'missing secret'
    )
  })

  it('resolves secrets from env fallback', async () => {
    process.env.AGE_SECRET_KEY = 'env-secret'

    const provider = new EnvProvider()

    await expect(provider.resolve(SECRET_REFS.AGE_SECRET_KEY)).resolves.toBe(
      'env-secret'
    )
  })

  it('resolves batches from env fallback', async () => {
    process.env.AGE_SECRET_KEY = 'env-secret'

    const provider = new EnvProvider()

    await expect(
      provider.resolveAll([SECRET_REFS.AGE_SECRET_KEY])
    ).resolves.toEqual({
      [SECRET_REFS.AGE_SECRET_KEY]: 'env-secret',
    })
  })

  it('falls back to env when 1Password is unavailable', async () => {
    const provider = await createSecretsProvider()

    expect(provider.name).toBe('env')
  })

  it('uses 1Password when available', async () => {
    process.env.OP_SERVICE_ACCOUNT_TOKEN = 'token'

    vi.mocked(createClient).mockResolvedValue({
      secrets: {
        resolve: vi.fn().mockResolvedValue('shh'),
      },
    })

    const provider = await createSecretsProvider()

    expect(provider.name).toBe('1password')
  })
})
