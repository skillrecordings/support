import { describe, expect, it } from 'vitest'
import { type LinkResult, autoLinkSkill } from './skill-link'

describe('autoLinkSkill', () => {
  it('should return a valid LinkResult', async () => {
    const result = await autoLinkSkill()

    // Verify the return shape regardless of actual filesystem state
    expect(result).toHaveProperty('status')
    expect(result).toHaveProperty('source')
    expect(result).toHaveProperty('target')
    expect(['linked', 'exists', 'conflict', 'error']).toContain(result.status)
    expect(result.source).toContain('.claude/skills/skill-cli')
    expect(result.target).toContain('.claude/skills/skill-cli')
  })

  it('should handle existing symlinks gracefully', async () => {
    // Running twice should be safe
    const result1 = await autoLinkSkill()
    const result2 = await autoLinkSkill()

    // Second call should either be 'exists' or same as first
    if (result1.status === 'linked') {
      expect(result2.status).toBe('exists')
    } else {
      expect(result2.status).toBe(result1.status)
    }
  })
})
