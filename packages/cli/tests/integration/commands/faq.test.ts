import { beforeEach, describe, expect, it, vi } from 'vitest'
import { faqClassify } from '../../../src/commands/faq/classify'
import { createTestContext } from '../../helpers/test-context'

vi.mock('fs', () => ({
  appendFileSync: vi.fn(),
  existsSync: vi.fn(() => false),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
}))

describe('faq commands', () => {
  beforeEach(() => {
    process.exitCode = undefined
  })

  it('reports missing parquet file', async () => {
    const { ctx, getStderr } = await createTestContext({ format: 'json' })

    await faqClassify(ctx, { parquetPath: '/tmp/missing.parquet' })

    expect(getStderr()).toContain('Parquet file not found')
    expect(process.exitCode).toBe(1)
  })
})
