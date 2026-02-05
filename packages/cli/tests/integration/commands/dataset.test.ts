import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { toEvalite } from '../../../src/commands/build-dataset'
import { createTestContext } from '../../helpers/test-context'

const parseLastJson = (stdout: string) => {
  const lines = stdout.split('\n').filter((line) => line.trim().length > 0)
  return JSON.parse(lines[lines.length - 1] ?? 'null')
}

describe('dataset commands', () => {
  it('to-evalite outputs JSON payload and writes file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dataset-'))
    const input = join(dir, 'input.json')
    const output = join(dir, 'output.json')

    writeFileSync(
      input,
      JSON.stringify([
        {
          id: 'id-1',
          app: 'app-1',
          conversationId: 'conv-1',
          customerEmail: 'user@example.com',
          triggerMessage: { subject: 'Hi', body: 'Hello', timestamp: 1 },
          agentResponse: {
            text: 'Reply',
            category: 'general',
            timestamp: 'now',
          },
          label: 'good',
        },
      ]),
      'utf-8'
    )

    const { ctx, getStdout } = await createTestContext({ format: 'json' })

    await toEvalite({ ctx, input, output })

    const payload = parseLastJson(getStdout()) as {
      success: boolean
      count: number
    }
    expect(payload.success).toBe(true)
    expect(payload.count).toBe(1)

    const stored = JSON.parse(readFileSync(output, 'utf-8')) as Array<{
      input: string
    }>
    expect(stored[0]?.input).toBe('Hello')
  })
})
