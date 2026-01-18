import { describe, expect, it } from 'vitest'
import * as core from '../index'

describe('packages/core', () => {
  it('exports runSupportAgent from agent module', () => {
    expect(core).toHaveProperty('runSupportAgent')
  })

  it('exports supportTools and createTool from tools module', () => {
    expect(core).toHaveProperty('supportTools')
    expect(core).toHaveProperty('createTool')
  })

  it('exports inngestClient from inngest module', () => {
    expect(core).toHaveProperty('inngestClient')
    expect(core).toHaveProperty('createServeHandler')
  })

  it('exports trust functions', () => {
    expect(core).toHaveProperty('shouldAutoSend')
    expect(core).toHaveProperty('calculateTrustScore')
    expect(core).toHaveProperty('getTrustScore')
    expect(core).toHaveProperty('recordOutcome')
  })

  it('exports router functions', () => {
    expect(core).toHaveProperty('routeMessage')
    expect(core).toHaveProperty('classifyMessage')
    expect(core).toHaveProperty('RouterCache')
  })
})
