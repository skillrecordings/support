/**
 * Tests for template analytics module
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type TemplateStats,
  analyzeTemplateHealth,
  calculateEditDistance,
  calculateEditPercentage,
  getAppTemplateStats,
  getTemplateStats,
  logTemplateApproval,
  logTemplateEdit,
  logTemplateUsage,
} from './analytics'

// Mock the axiom log function
vi.mock('../observability/axiom', () => ({
  log: vi.fn().mockResolvedValue(undefined),
}))

describe('Template Analytics', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('logTemplateUsage', () => {
    it('logs template usage when template is used', async () => {
      const { log } = await import('../observability/axiom')

      await logTemplateUsage({
        templateId: 'front_template_abc123',
        templateName: 'Access Issues Response',
        appId: 'total-typescript',
        conversationId: 'cnv_xyz',
        category: 'support_access',
        matchConfidence: 0.92,
        wasUsed: true,
        matchDurationMs: 45,
      })

      expect(log).toHaveBeenCalledWith(
        'info',
        'template.usage',
        expect.objectContaining({
          type: 'template-analytics',
          eventType: 'usage',
          templateId: 'front_template_abc123',
          templateName: 'Access Issues Response',
          appId: 'total-typescript',
          conversationId: 'cnv_xyz',
          category: 'support_access',
          matchConfidence: 0.92,
          wasUsed: true,
          matchDurationMs: 45,
        })
      )
    })

    it('logs template usage when template is skipped', async () => {
      const { log } = await import('../observability/axiom')

      await logTemplateUsage({
        templateId: 'front_template_abc123',
        templateName: 'Access Issues Response',
        appId: 'total-typescript',
        conversationId: 'cnv_xyz',
        category: 'support_access',
        matchConfidence: 0.75,
        wasUsed: false,
        candidates: [
          { templateId: 't1', name: 'Template 1', score: 0.75 },
          { templateId: 't2', name: 'Template 2', score: 0.65 },
        ],
      })

      expect(log).toHaveBeenCalledWith(
        'info',
        'template.usage',
        expect.objectContaining({
          wasUsed: false,
          matchConfidence: 0.75,
          candidateCount: 2,
        })
      )
    })
  })

  describe('logTemplateEdit', () => {
    it('logs template edit with severity classification', async () => {
      const { log } = await import('../observability/axiom')

      await logTemplateEdit({
        templateId: 'front_template_abc123',
        templateName: 'Access Issues Response',
        appId: 'total-typescript',
        conversationId: 'cnv_xyz',
        originalLength: 450,
        editedLength: 520,
        editDistance: 85,
        editPercentage: 18.9,
        editorId: 'user_123',
      })

      expect(log).toHaveBeenCalledWith(
        'info',
        'template.edit',
        expect.objectContaining({
          type: 'template-analytics',
          eventType: 'edit',
          templateId: 'front_template_abc123',
          originalLength: 450,
          editedLength: 520,
          editDistance: 85,
          editPercentage: 18.9,
          editSeverity: 'moderate', // 18.9% falls in 10-30% range
          lengthDelta: 70,
          editorId: 'user_123',
        })
      )
    })

    it('classifies minor edits correctly', async () => {
      const { log } = await import('../observability/axiom')

      await logTemplateEdit({
        templateId: 't1',
        templateName: 'Test',
        appId: 'app',
        conversationId: 'cnv',
        originalLength: 100,
        editedLength: 105,
        editDistance: 5,
        editPercentage: 5,
      })

      expect(log).toHaveBeenCalledWith(
        'info',
        'template.edit',
        expect.objectContaining({
          editSeverity: 'minor',
        })
      )
    })

    it('classifies significant edits correctly', async () => {
      const { log } = await import('../observability/axiom')

      await logTemplateEdit({
        templateId: 't1',
        templateName: 'Test',
        appId: 'app',
        conversationId: 'cnv',
        originalLength: 100,
        editedLength: 140,
        editDistance: 40,
        editPercentage: 35,
      })

      expect(log).toHaveBeenCalledWith(
        'info',
        'template.edit',
        expect.objectContaining({
          editSeverity: 'significant',
        })
      )
    })

    it('classifies major edits correctly', async () => {
      const { log } = await import('../observability/axiom')

      await logTemplateEdit({
        templateId: 't1',
        templateName: 'Test',
        appId: 'app',
        conversationId: 'cnv',
        originalLength: 100,
        editedLength: 180,
        editDistance: 60,
        editPercentage: 55,
      })

      expect(log).toHaveBeenCalledWith(
        'info',
        'template.edit',
        expect.objectContaining({
          editSeverity: 'major',
        })
      )
    })
  })

  describe('logTemplateApproval', () => {
    it('logs template approval', async () => {
      const { log } = await import('../observability/axiom')

      await logTemplateApproval({
        templateId: 'front_template_abc123',
        templateName: 'Access Issues Response',
        appId: 'total-typescript',
        conversationId: 'cnv_xyz',
        approved: true,
        reviewerId: 'user_123',
        reviewDurationMs: 15000,
      })

      expect(log).toHaveBeenCalledWith(
        'info',
        'template.approval',
        expect.objectContaining({
          type: 'template-analytics',
          eventType: 'approval',
          templateId: 'front_template_abc123',
          approved: true,
          reviewerId: 'user_123',
          reviewDurationMs: 15000,
        })
      )
    })

    it('logs template rejection with reason', async () => {
      const { log } = await import('../observability/axiom')

      await logTemplateApproval({
        templateId: 'front_template_abc123',
        templateName: 'Access Issues Response',
        appId: 'total-typescript',
        conversationId: 'cnv_xyz',
        approved: false,
        rejectionReason: 'Response does not address customer concern',
        reviewerId: 'user_456',
      })

      expect(log).toHaveBeenCalledWith(
        'info',
        'template.approval',
        expect.objectContaining({
          approved: false,
          rejectionReason: 'Response does not address customer concern',
        })
      )
    })
  })

  describe('getTemplateStats', () => {
    it('returns null when no data available', async () => {
      const stats = await getTemplateStats({
        appId: 'total-typescript',
        templateId: 'front_template_abc123',
      })

      expect(stats).toBeNull()
    })
  })

  describe('getAppTemplateStats', () => {
    it('returns empty array when no data available', async () => {
      const stats = await getAppTemplateStats({
        appId: 'total-typescript',
      })

      expect(stats).toEqual([])
    })
  })

  describe('calculateEditDistance', () => {
    it('returns 0 for identical strings', () => {
      expect(calculateEditDistance('hello', 'hello')).toBe(0)
    })

    it('calculates single character insertion', () => {
      expect(calculateEditDistance('hello', 'helloo')).toBe(1)
    })

    it('calculates single character deletion', () => {
      expect(calculateEditDistance('hello', 'helo')).toBe(1)
    })

    it('calculates single character substitution', () => {
      expect(calculateEditDistance('hello', 'hella')).toBe(1)
    })

    it('calculates complex edit distance', () => {
      expect(calculateEditDistance('kitten', 'sitting')).toBe(3)
    })

    it('handles empty strings', () => {
      expect(calculateEditDistance('', '')).toBe(0)
      expect(calculateEditDistance('hello', '')).toBe(5)
      expect(calculateEditDistance('', 'hello')).toBe(5)
    })

    it('calculates distance for longer strings', () => {
      const original = 'The quick brown fox jumps over the lazy dog'
      const edited = 'The quick brown cat jumps over the sleepy dog'
      // fox -> cat = 3, lazy -> sleepy = 4
      const distance = calculateEditDistance(original, edited)
      expect(distance).toBeGreaterThan(0)
      expect(distance).toBeLessThan(original.length)
    })
  })

  describe('calculateEditPercentage', () => {
    it('returns 0 for identical strings', () => {
      expect(calculateEditPercentage('hello', 'hello')).toBe(0)
    })

    it('returns 0 for empty strings', () => {
      expect(calculateEditPercentage('', '')).toBe(0)
    })

    it('calculates percentage correctly', () => {
      // 'abc' to 'xyz' requires 3 substitutions, max length is 3
      // So edit percentage = (3/3) * 100 = 100%
      expect(calculateEditPercentage('abc', 'xyz')).toBe(100)
    })

    it('handles length differences', () => {
      // 'hello' (5) to 'helloo' (6) is 1 edit, max length 6
      // (1/6) * 100 = 16.67%
      const pct = calculateEditPercentage('hello', 'helloo')
      expect(pct).toBeCloseTo(16.67, 1)
    })
  })

  describe('analyzeTemplateHealth', () => {
    it('identifies healthy templates', () => {
      const stats: TemplateStats = {
        templateId: 't1',
        appId: 'app',
        usageCount: 50,
        editRate: 0.2,
        approvalRate: 0.9,
        avgEditDistance: 25,
        lastUsed: new Date(),
        staleDays: 5,
      }

      const health = analyzeTemplateHealth(stats)

      expect(health.needsAttention).toBe(false)
      expect(health.reasons).toHaveLength(0)
      expect(health.severity).toBe('low')
    })

    it('flags high edit rate', () => {
      const stats: TemplateStats = {
        templateId: 't1',
        appId: 'app',
        usageCount: 50,
        editRate: 0.75,
        approvalRate: 0.9,
        avgEditDistance: 25,
        lastUsed: new Date(),
        staleDays: 5,
      }

      const health = analyzeTemplateHealth(stats)

      expect(health.needsAttention).toBe(true)
      expect(health.reasons).toContainEqual(
        expect.stringContaining('High edit rate')
      )
    })

    it('flags low approval rate', () => {
      const stats: TemplateStats = {
        templateId: 't1',
        appId: 'app',
        usageCount: 50,
        editRate: 0.1,
        approvalRate: 0.4,
        avgEditDistance: 25,
        lastUsed: new Date(),
        staleDays: 5,
      }

      const health = analyzeTemplateHealth(stats)

      expect(health.needsAttention).toBe(true)
      expect(health.reasons).toContainEqual(
        expect.stringContaining('Low approval rate')
      )
      expect(health.severity).toBe('medium')
    })

    it('flags stale templates', () => {
      const stats: TemplateStats = {
        templateId: 't1',
        appId: 'app',
        usageCount: 50,
        editRate: 0.1,
        approvalRate: 0.9,
        avgEditDistance: 25,
        lastUsed: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000),
        staleDays: 100,
      }

      const health = analyzeTemplateHealth(stats)

      expect(health.needsAttention).toBe(true)
      expect(health.reasons).toContainEqual(expect.stringContaining('Stale'))
    })

    it('flags large average edits', () => {
      const stats: TemplateStats = {
        templateId: 't1',
        appId: 'app',
        usageCount: 50,
        editRate: 0.3,
        approvalRate: 0.9,
        avgEditDistance: 150,
        lastUsed: new Date(),
        staleDays: 5,
      }

      const health = analyzeTemplateHealth(stats)

      expect(health.needsAttention).toBe(true)
      expect(health.reasons).toContainEqual(
        expect.stringContaining('Large average edits')
      )
    })

    it('assigns high severity for multiple issues', () => {
      const stats: TemplateStats = {
        templateId: 't1',
        appId: 'app',
        usageCount: 50,
        editRate: 0.8,
        approvalRate: 0.3,
        avgEditDistance: 150,
        lastUsed: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000),
        staleDays: 100,
      }

      const health = analyzeTemplateHealth(stats)

      expect(health.needsAttention).toBe(true)
      expect(health.severity).toBe('high')
      expect(health.reasons.length).toBeGreaterThanOrEqual(3)
    })

    it('assigns high severity for very low approval rate', () => {
      const stats: TemplateStats = {
        templateId: 't1',
        appId: 'app',
        usageCount: 50,
        editRate: 0.3,
        approvalRate: 0.25,
        avgEditDistance: 25,
        lastUsed: new Date(),
        staleDays: 5,
      }

      const health = analyzeTemplateHealth(stats)

      expect(health.severity).toBe('high')
    })

    it('assigns high severity for very high edit rate', () => {
      const stats: TemplateStats = {
        templateId: 't1',
        appId: 'app',
        usageCount: 50,
        editRate: 0.85,
        approvalRate: 0.7,
        avgEditDistance: 25,
        lastUsed: new Date(),
        staleDays: 5,
      }

      const health = analyzeTemplateHealth(stats)

      expect(health.severity).toBe('high')
    })
  })
})
