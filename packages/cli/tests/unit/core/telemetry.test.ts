import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  resolveTelemetryUser,
  sendTelemetryEvent,
} from '../../../src/core/telemetry'

const mockIngest = vi.fn()

vi.mock('@axiomhq/js', () => ({
  Axiom: vi.fn(() => ({
    ingest: mockIngest,
  })),
}))

const baseEvent = {
  command: 'front.inbox',
  duration: 125,
  success: true,
  platform: 'darwin',
  user: 'joel',
}

describe('telemetry', () => {
  const originalEnv = {
    AXIOM_TOKEN: process.env.AXIOM_TOKEN,
    AXIOM_DATASET: process.env.AXIOM_DATASET,
    SKILL_NO_TELEMETRY: process.env.SKILL_NO_TELEMETRY,
    USER: process.env.USER,
    LOGNAME: process.env.LOGNAME,
    USERNAME: process.env.USERNAME,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockIngest.mockResolvedValue(undefined)
    process.env.AXIOM_TOKEN = 'test-token'
    process.env.AXIOM_DATASET = 'support-agent'
    delete process.env.SKILL_NO_TELEMETRY
  })

  afterEach(() => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  })

  it('sends telemetry events to Axiom', async () => {
    await sendTelemetryEvent(baseEvent)

    expect(mockIngest).toHaveBeenCalledWith(
      'support-agent',
      expect.objectContaining({
        command: 'front.inbox',
        duration: 125,
        success: true,
        platform: 'darwin',
        user: 'joel',
        _time: expect.any(String),
      })
    )
  })

  it('skips when SKILL_NO_TELEMETRY=1', async () => {
    process.env.SKILL_NO_TELEMETRY = '1'

    await sendTelemetryEvent(baseEvent)

    expect(mockIngest).not.toHaveBeenCalled()
  })

  it('skips when AXIOM_TOKEN is missing', async () => {
    delete process.env.AXIOM_TOKEN

    await sendTelemetryEvent(baseEvent)

    expect(mockIngest).not.toHaveBeenCalled()
  })

  it('sanitizes user identity values', () => {
    process.env.USER = 'joel@example.com'

    expect(resolveTelemetryUser()).toBe('joel')
  })

  it('swallows ingest errors', async () => {
    mockIngest.mockRejectedValueOnce(new Error('boom'))

    await expect(sendTelemetryEvent(baseEvent)).resolves.toBeUndefined()
  })
})
