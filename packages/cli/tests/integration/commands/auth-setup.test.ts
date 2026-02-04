import { beforeEach, describe, expect, it, vi } from 'vitest'
import { authSetupAction } from '../../../src/commands/auth/setup'
import {
  ONEPASSWORD_ITEM_IDS,
  buildOnePasswordItemLink,
} from '../../../src/core/onepassword-links'
import { createTestContext } from '../../helpers/test-context'

const mockExecSync = vi.fn()
const mockCreateSecretsProvider = vi.hoisted(() => vi.fn())

vi.mock('child_process', () => ({
  execSync: (cmd: string, opts: unknown) => mockExecSync(cmd, opts),
}))

vi.mock('../../../src/core/secrets', () => ({
  createSecretsProvider: mockCreateSecretsProvider,
}))

const mockOpExecSync = (overrides: Partial<Record<string, string>> = {}) => {
  mockExecSync.mockImplementation((cmd: string) => {
    if (cmd.startsWith('op --version')) {
      return overrides.version ?? '2.24.0'
    }
    if (cmd.startsWith('op whoami')) {
      return (
        overrides.whoami ??
        JSON.stringify({ account: { domain: 'egghead.1password.com' } })
      )
    }
    if (cmd.startsWith('op vault get')) {
      return overrides.vault ?? '{}'
    }
    if (cmd.startsWith('op read')) {
      if (cmd.includes('skill-cli-age-key')) {
        return overrides.ageKey ?? 'AGE-SECRET-KEY-ABC123'
      }
      if (cmd.includes('skill-cli-service-account')) {
        return overrides.token ?? 'op_test_token'
      }
    }
    throw new Error(`Unexpected command: ${cmd}`)
  })
}

describe('auth setup command', () => {
  beforeEach(() => {
    mockExecSync.mockReset()
    mockCreateSecretsProvider.mockReset()
    delete process.env.AGE_SECRET_KEY
    delete process.env.OP_SERVICE_ACCOUNT_TOKEN
    process.exitCode = undefined
  })

  it('builds correct 1Password deep links', () => {
    const link = buildOnePasswordItemLink(ONEPASSWORD_ITEM_IDS.ageKey)
    expect(link).toContain(`i=${ONEPASSWORD_ITEM_IDS.ageKey}`)
    expect(link).toContain('start.1password.com/open/i')
  })

  it('completes setup using op CLI', async () => {
    mockOpExecSync()
    mockCreateSecretsProvider.mockResolvedValue({
      name: '1password',
      isAvailable: vi.fn(async () => true),
      resolve: vi.fn(async () => 'resolved'),
      resolveAll: vi.fn(async () => ({})),
    })

    const { ctx, getStdout, getStderr } = await createTestContext({
      format: 'json',
    })

    await authSetupAction(ctx, { json: true })

    expect(getStderr()).toBe('')

    const payload = JSON.parse(getStdout()) as {
      success: boolean
      tokenConfigured: boolean
      ageKeyConfigured: boolean
    }

    expect(payload.success).toBe(true)
    expect(payload.tokenConfigured).toBe(true)
    expect(payload.ageKeyConfigured).toBe(true)
    expect(process.env.AGE_SECRET_KEY).toBe('AGE-SECRET-KEY-ABC123')
    expect(process.env.OP_SERVICE_ACCOUNT_TOKEN).toBe('op_test_token')
  })

  it('fails when AGE_SECRET_KEY format is invalid', async () => {
    mockOpExecSync({ ageKey: 'invalid-key' })
    mockCreateSecretsProvider.mockResolvedValue({
      name: '1password',
      isAvailable: vi.fn(async () => true),
      resolve: vi.fn(async () => 'resolved'),
      resolveAll: vi.fn(async () => ({})),
    })

    const { ctx, getStdout, getStderr } = await createTestContext({
      format: 'json',
    })

    await authSetupAction(ctx, { json: true })

    expect(getStderr()).toBe('')
    const payload = JSON.parse(getStdout()) as {
      success: boolean
      error?: string
    }

    expect(payload.success).toBe(false)
    expect(payload.error).toContain('AGE_SECRET_KEY format looks invalid')
    expect(process.exitCode).toBeGreaterThan(0)
  })

  it('prints install instructions when op is missing', async () => {
    mockExecSync.mockImplementation(() => {
      throw new Error('op not found')
    })

    const { ctx, getStderr } = await createTestContext({ format: 'text' })

    await authSetupAction(ctx, {})

    expect(getStderr()).toContain(
      '❌ 1Password CLI (op) is required but not found.'
    )
  })
})
