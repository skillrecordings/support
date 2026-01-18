import { describe, it, expect } from 'vitest'
import * as core from '../index'

describe('packages/core', () => {
  it('exports agent module', () => {
    expect(core).toHaveProperty('agent')
  })

  it('exports tools module', () => {
    expect(core).toHaveProperty('tools')
  })

  it('exports workflows module', () => {
    expect(core).toHaveProperty('workflows')
  })

  it('exports registry module', () => {
    expect(core).toHaveProperty('registry')
  })

  it('exports webhooks module', () => {
    expect(core).toHaveProperty('webhooks')
  })
})
