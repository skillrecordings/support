import { describe, it, expect } from 'vitest'
import { executeApprovedAction } from '../inngest/workflows/execute-approved-action'

describe('executeApprovedAction workflow', () => {
  it('exports a function', () => {
    expect(executeApprovedAction).toBeDefined()
    expect(typeof executeApprovedAction).toBe('object')
  })

  it('has correct id', () => {
    expect(executeApprovedAction.id()).toBe('execute-approved-action')
  })

  it('has correct name', () => {
    expect(executeApprovedAction.name).toBe('Execute Approved Action')
  })
})
