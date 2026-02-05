import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestContext } from '../../helpers/test-context'

const mockGetDb = vi.fn()
const mockCloseDb = vi.fn()

vi.mock('@skillrecordings/database', () => ({
  AppsTable: {
    slug: 'slug',
    name: 'name',
    integration_base_url: 'integration_base_url',
    webhook_secret: 'webhook_secret',
  },
  eq: vi.fn((..._args: unknown[]) => ({})),
  getDb: (...args: unknown[]) => mockGetDb(...args),
  closeDb: (...args: unknown[]) => mockCloseDb(...args),
}))

import { health } from '../../../src/commands/health'

const parseLastJson = (stdout: string) => {
  const lines = stdout.split('\n').filter((line) => line.trim().length > 0)
  return JSON.parse(lines[lines.length - 1] ?? 'null')
}

describe('health commands', () => {
  beforeEach(() => {
    process.exitCode = undefined
    mockGetDb.mockReset()
    mockCloseDb.mockReset()
  })

  it('list outputs JSON payload', async () => {
    mockGetDb.mockImplementation(() => ({
      select: () => ({
        from: async () => [
          {
            slug: 'app-1',
            name: 'App One',
            integration_base_url: 'https://app.test',
          },
        ],
      }),
    }))

    const { ctx, getStdout } = await createTestContext({ format: 'json' })

    await health(ctx, undefined, { list: true, json: true })

    const payload = parseLastJson(getStdout()) as Array<{ slug: string }>
    expect(payload[0]?.slug).toBe('app-1')
  })
})
