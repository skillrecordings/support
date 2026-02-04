/**
 * Tests for stale template detection module.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type StaleTemplatesResult,
  buildStalesSummary,
  findStaleTemplates,
  formatStaleReport,
} from './stale'

// Create mock query function that we can control
const mockQuery = vi.fn()

// Mock the vector client
vi.mock('../vector/client', () => ({
  getVectorIndex: vi.fn(() => ({
    query: mockQuery,
  })),
}))

describe('findStaleTemplates', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockQuery.mockReset()
  })

  it('should identify unused templates', async () => {
    const now = Date.now()
    const hundredDaysAgo = new Date(
      now - 100 * 24 * 60 * 60 * 1000
    ).toISOString()

    mockQuery.mockResolvedValue([
      {
        id: 'front_template_tmp_active',
        score: 0.95,
        data: 'Active template content',
        metadata: {
          type: 'response',
          source: 'canned-response',
          appId: 'test-app',
          title: 'Active Template',
          usageCount: 50,
          lastUpdated: new Date().toISOString(),
        },
      },
      {
        id: 'front_template_tmp_stale',
        score: 0.85,
        data: 'Stale template content',
        metadata: {
          type: 'response',
          source: 'canned-response',
          appId: 'test-app',
          title: 'Stale Template',
          usageCount: 0,
          lastUpdated: hundredDaysAgo,
        },
      },
    ])

    const result = await findStaleTemplates({
      appId: 'test-app',
      unusedDays: 90,
    })

    expect(result.stale).toHaveLength(1)
    expect(result.stale[0]!.name).toBe('Stale Template')
    expect(result.stale[0]!.reason).toBe('unused')
    expect(result.stale[0]!.daysSinceUsed).toBeGreaterThanOrEqual(100)
    expect(result.totalScanned).toBe(2)
    expect(result.activeCount).toBe(1)
  })

  it('should not flag templates under the unused threshold', async () => {
    const fiftyDaysAgo = new Date(
      Date.now() - 50 * 24 * 60 * 60 * 1000
    ).toISOString()

    mockQuery.mockResolvedValue([
      {
        id: 'front_template_tmp_recent',
        score: 0.9,
        data: 'Recent template',
        metadata: {
          type: 'response',
          source: 'canned-response',
          appId: 'test-app',
          title: 'Recent Template',
          usageCount: 0,
          lastUpdated: fiftyDaysAgo,
        },
      },
    ])

    const result = await findStaleTemplates({
      appId: 'test-app',
      unusedDays: 90,
    })

    expect(result.stale).toHaveLength(0)
    expect(result.totalScanned).toBe(1)
  })

  it('should respect minUsageCount parameter', async () => {
    const hundredDaysAgo = new Date(
      Date.now() - 100 * 24 * 60 * 60 * 1000
    ).toISOString()

    mockQuery.mockResolvedValue([
      {
        id: 'front_template_tmp_used',
        score: 0.85,
        data: 'Used template',
        metadata: {
          type: 'response',
          source: 'canned-response',
          appId: 'test-app',
          title: 'Used Template',
          usageCount: 5,
          lastUpdated: hundredDaysAgo,
        },
      },
    ])

    // With minUsageCount of 10, this should be flagged
    const result = await findStaleTemplates({
      appId: 'test-app',
      unusedDays: 90,
      minUsageCount: 10,
    })

    expect(result.stale).toHaveLength(1)
    expect(result.stale[0]!.reason).toBe('unused')
  })

  it('should extract Front ID correctly', async () => {
    mockQuery.mockResolvedValue([
      {
        id: 'front_template_rsp_abc123',
        score: 0.85,
        data: 'Template content',
        metadata: {
          type: 'response',
          source: 'canned-response',
          appId: 'test-app',
          title: 'Test Template',
          usageCount: 0,
          lastUpdated: new Date(
            Date.now() - 100 * 24 * 60 * 60 * 1000
          ).toISOString(),
        },
      },
    ])

    const result = await findStaleTemplates({
      appId: 'test-app',
      unusedDays: 90,
    })

    expect(result.stale[0]!.frontId).toBe('rsp_abc123')
    expect(result.stale[0]!.templateId).toBe('front_template_rsp_abc123')
  })

  it('should sort results by days since used (most stale first)', async () => {
    mockQuery.mockResolvedValue([
      {
        id: 'front_template_tmp_1',
        score: 0.85,
        data: 'Template 1',
        metadata: {
          type: 'response',
          source: 'canned-response',
          appId: 'test-app',
          title: 'Template 1',
          usageCount: 0,
          lastUpdated: new Date(
            Date.now() - 95 * 24 * 60 * 60 * 1000
          ).toISOString(),
        },
      },
      {
        id: 'front_template_tmp_2',
        score: 0.85,
        data: 'Template 2',
        metadata: {
          type: 'response',
          source: 'canned-response',
          appId: 'test-app',
          title: 'Template 2',
          usageCount: 0,
          lastUpdated: new Date(
            Date.now() - 200 * 24 * 60 * 60 * 1000
          ).toISOString(),
        },
      },
    ])

    const result = await findStaleTemplates({
      appId: 'test-app',
      unusedDays: 90,
    })

    expect(result.stale).toHaveLength(2)
    expect(result.stale[0]!.name).toBe('Template 2') // 200 days - most stale
    expect(result.stale[1]!.name).toBe('Template 1') // 95 days - less stale
  })

  it('should handle empty results', async () => {
    mockQuery.mockResolvedValue([])

    const result = await findStaleTemplates({
      appId: 'test-app',
      unusedDays: 90,
    })

    expect(result.stale).toHaveLength(0)
    expect(result.totalScanned).toBe(0)
    expect(result.activeCount).toBe(0)
  })

  it('should handle templates without lastUpdated metadata', async () => {
    mockQuery.mockResolvedValue([
      {
        id: 'front_template_tmp_no_date',
        score: 0.85,
        data: 'Template without date',
        metadata: {
          type: 'response',
          source: 'canned-response',
          appId: 'test-app',
          title: 'No Date Template',
          usageCount: 0,
          // No lastUpdated field
        },
      },
    ])

    const result = await findStaleTemplates({
      appId: 'test-app',
      unusedDays: 90,
    })

    // Should be flagged as stale (assumes stale when no date)
    expect(result.stale).toHaveLength(1)
    expect(result.stale[0]!.reason).toBe('unused')
  })
})

describe('formatStaleReport', () => {
  it('should format report with no stale templates', () => {
    const result: StaleTemplatesResult = {
      stale: [],
      totalScanned: 10,
      activeCount: 10,
      byReason: { unused: 0, low_match: 0, high_edit_rate: 0, superseded: 0 },
      scannedAt: new Date().toISOString(),
    }

    const report = formatStaleReport('test-app', result)

    expect(report).toContain('test-app')
    expect(report).toContain('Scanned: 10')
    expect(report).toContain('No stale templates found')
  })

  it('should format report with stale templates', () => {
    const result: StaleTemplatesResult = {
      stale: [
        {
          templateId: 'front_template_tmp_1',
          frontId: 'tmp_1',
          name: 'Refund Template',
          reason: 'unused',
          daysSinceUsed: 100,
          usageCount: 0,
        },
        {
          templateId: 'front_template_tmp_2',
          frontId: 'tmp_2',
          name: 'Access Template',
          reason: 'high_edit_rate',
          daysSinceUsed: 30,
          usageCount: 20,
          editRate: 0.6,
        },
      ],
      totalScanned: 50,
      activeCount: 48,
      byReason: { unused: 1, low_match: 0, high_edit_rate: 1, superseded: 0 },
      scannedAt: new Date().toISOString(),
    }

    const report = formatStaleReport('test-app', result)

    expect(report).toContain('test-app')
    expect(report).toContain('Active: 48')
    expect(report).toContain('Stale: 2')
    expect(report).toContain('Refund Template')
    expect(report).toContain('Access Template')
    expect(report).toContain('💤') // unused emoji
    expect(report).toContain('✏️') // high_edit_rate emoji
  })

  it('should truncate to top 10 with more message', () => {
    const staleTemplates = Array.from({ length: 15 }, (_, i) => ({
      templateId: `front_template_tmp_${i}`,
      frontId: `tmp_${i}`,
      name: `Template ${i}`,
      reason: 'unused' as const,
      daysSinceUsed: 100 + i,
      usageCount: 0,
    }))

    const result: StaleTemplatesResult = {
      stale: staleTemplates,
      totalScanned: 50,
      activeCount: 35,
      byReason: { unused: 15, low_match: 0, high_edit_rate: 0, superseded: 0 },
      scannedAt: new Date().toISOString(),
    }

    const report = formatStaleReport('test-app', result)

    expect(report).toContain('...and 5 more')
  })
})

describe('buildStalesSummary', () => {
  it('should aggregate stats from multiple apps', () => {
    const results = new Map<string, StaleTemplatesResult>([
      [
        'app-1',
        {
          stale: [
            {
              templateId: 't1',
              frontId: 'f1',
              name: 'T1',
              reason: 'unused',
              daysSinceUsed: 100,
              usageCount: 0,
            },
          ],
          totalScanned: 10,
          activeCount: 9,
          byReason: {
            unused: 1,
            low_match: 0,
            high_edit_rate: 0,
            superseded: 0,
          },
          scannedAt: new Date().toISOString(),
        },
      ],
      [
        'app-2',
        {
          stale: [
            {
              templateId: 't2',
              frontId: 'f2',
              name: 'T2',
              reason: 'high_edit_rate',
              daysSinceUsed: 30,
              usageCount: 10,
              editRate: 0.7,
            },
            {
              templateId: 't3',
              frontId: 'f3',
              name: 'T3',
              reason: 'low_match',
              daysSinceUsed: 60,
              usageCount: 0,
            },
          ],
          totalScanned: 20,
          activeCount: 18,
          byReason: {
            unused: 0,
            low_match: 1,
            high_edit_rate: 1,
            superseded: 0,
          },
          scannedAt: new Date().toISOString(),
        },
      ],
    ])

    const summary = buildStalesSummary(results)

    expect(summary.totalApps).toBe(2)
    expect(summary.totalTemplates).toBe(30)
    expect(summary.totalStale).toBe(3)
    expect(summary.byReason.unused).toBe(1)
    expect(summary.byReason.high_edit_rate).toBe(1)
    expect(summary.byReason.low_match).toBe(1)
    expect(summary.byReason.superseded).toBe(0)
  })

  it('should handle empty results', () => {
    const results = new Map<string, StaleTemplatesResult>()

    const summary = buildStalesSummary(results)

    expect(summary.totalApps).toBe(0)
    expect(summary.totalTemplates).toBe(0)
    expect(summary.totalStale).toBe(0)
  })
})
