import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CLIError } from '../../../../src/core/errors'

const mockCreateInstrumentedFrontClient = vi.hoisted(() => vi.fn())

vi.mock('@skillrecordings/core/front/instrumented-client', () => ({
  createInstrumentedFrontClient: mockCreateInstrumentedFrontClient,
}))

import {
  getFrontClient,
  normalizeId,
  requireFrontToken,
} from '../../../../src/commands/front/client'

describe('front client helpers', () => {
  const originalFrontToken = process.env.FRONT_API_TOKEN

  beforeEach(() => {
    mockCreateInstrumentedFrontClient.mockReset()
    delete process.env.FRONT_API_TOKEN
  })

  it('requireFrontToken throws when FRONT_API_TOKEN is missing', () => {
    expect(() => requireFrontToken()).toThrow(CLIError)
  })

  it('requireFrontToken returns token when present', () => {
    process.env.FRONT_API_TOKEN = 'front-token'

    expect(requireFrontToken()).toBe('front-token')
  })

  it('normalizeId strips URL prefixes', () => {
    expect(normalizeId('https://app.frontapp.com/open/cnv_123')).toBe('cnv_123')
  })

  it('normalizeId passes through IDs', () => {
    expect(normalizeId('cnv_456')).toBe('cnv_456')
  })

  it('getFrontClient uses the Front token', () => {
    process.env.FRONT_API_TOKEN = 'front-token'
    const mockClient = { raw: {} }
    mockCreateInstrumentedFrontClient.mockReturnValue(mockClient)

    const client = getFrontClient()

    expect(mockCreateInstrumentedFrontClient).toHaveBeenCalledWith({
      apiToken: 'front-token',
    })
    expect(client).toBe(mockClient)
  })

  afterEach(() => {
    if (originalFrontToken === undefined) {
      delete process.env.FRONT_API_TOKEN
    } else {
      process.env.FRONT_API_TOKEN = originalFrontToken
    }
  })
})
