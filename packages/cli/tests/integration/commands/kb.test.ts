import { describe, expect, it, vi } from 'vitest'
import { list } from '../../../src/commands/kb-sync'
import { createTestContext } from '../../helpers/test-context'

vi.mock('@skillrecordings/core/knowledge/ingest', () => ({
  PRODUCT_SOURCES: {},
  ingest: vi.fn(),
  listProductSources: vi.fn(() => [
    {
      appId: 'app-1',
      enabled: true,
      format: 'markdown',
      defaultSource: 'docs',
      defaultCategory: 'general',
      sourceUrls: ['https://example.com'],
    },
  ]),
}))

const parseLastJson = (stdout: string) => {
  const lines = stdout.split('\n').filter((line) => line.trim().length > 0)
  return JSON.parse(lines[lines.length - 1] ?? 'null')
}

describe('kb commands', () => {
  it('list outputs JSON payload', async () => {
    const { ctx, getStdout } = await createTestContext({ format: 'json' })

    await list(ctx, { json: true })

    const payload = parseLastJson(getStdout()) as Array<{ appId: string }>
    expect(payload[0]?.appId).toBe('app-1')
  })
})
