import { describe, expect, it } from 'vitest'
import { CATEGORY_THRESHOLDS, getCategoryThreshold } from '../thresholds'

describe('category thresholds', () => {
  it('uses category-specific threshold when defined', () => {
    const threshold = getCategoryThreshold('support_refund')
    expect(threshold).toBe(CATEGORY_THRESHOLDS.support_refund)
    expect(threshold.autoSendMinConfidence).toBe(0.95)
    expect(threshold.autoSendMinVolume).toBe(100)
  })

  it('falls back to default threshold', () => {
    const threshold = getCategoryThreshold('unknown_category')
    expect(threshold).toBe(CATEGORY_THRESHOLDS.default)
    expect(threshold.autoSendMinConfidence).toBe(0.95)
    expect(threshold.autoSendMinVolume).toBe(50)
  })
})
