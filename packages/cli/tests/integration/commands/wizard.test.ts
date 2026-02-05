import { describe, expect, it, vi } from 'vitest'
import { wizard } from '../../../src/commands/wizard'
import { createTestContext } from '../../helpers/test-context'

vi.mock('@inquirer/prompts', () => ({
  input: vi.fn(
    async ({ default: defaultValue }: { default?: string }) =>
      defaultValue ?? 'Test App'
  ),
  checkbox: vi.fn(async () => ['lookupUser', 'getPurchases']),
  confirm: vi.fn(async () => false),
  select: vi.fn(async () => 'option'),
}))

vi.mock('node:crypto', () => ({
  randomUUID: vi.fn(() => '00000000-0000-0000-0000-000000000000'),
  randomBytes: vi.fn(() => Buffer.from('a'.repeat(64), 'hex')),
}))

const parseLastJson = (stdout: string) => {
  const lines = stdout.split('\n').filter((line) => line.trim().length > 0)
  return JSON.parse(lines[lines.length - 1] ?? 'null')
}

describe('wizard command', () => {
  it('outputs JSON result', async () => {
    const { ctx, getStdout } = await createTestContext({ format: 'json' })

    await wizard(ctx, { json: true })

    const payload = parseLastJson(getStdout()) as {
      success: boolean
      app?: { slug: string }
    }
    expect(payload.success).toBe(true)
    expect(payload.app?.slug).toBe('test-app')
  })
})
