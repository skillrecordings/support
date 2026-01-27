/**
 * Draft prompts unit tests
 *
 * Tests the dynamic prompt building functions that replace hardcoded values
 * with SDK-gathered data (refund policy, invoice URLs, promotions, license info).
 */

import { describe, expect, it } from 'vitest'
import type { GatherOutput } from '../types'
import { BASE_DRAFT_PROMPT, buildCategoryPrompt } from './draft-prompts'

// ============================================================================
// Helpers
// ============================================================================

function makeEmptyContext(): GatherOutput {
  return {
    user: null,
    purchases: [],
    knowledge: [],
    history: [],
    priorMemory: [],
    priorConversations: [],
    gatherErrors: [],
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('draft-prompts', () => {
  describe('BASE_DRAFT_PROMPT', () => {
    it('should contain the style guide', () => {
      expect(BASE_DRAFT_PROMPT).toContain('Style Guide')
      expect(BASE_DRAFT_PROMPT).toContain('Be direct and concise')
    })

    it('should contain banned phrases', () => {
      expect(BASE_DRAFT_PROMPT).toContain('NEVER Use These Phrases')
      expect(BASE_DRAFT_PROMPT).toContain('Happy to help')
    })
  })

  // ────────────────────────────────────────────────────────────────────────
  // support_refund — dynamic refund policy
  // ────────────────────────────────────────────────────────────────────────

  describe('support_refund prompt', () => {
    it('should fall back to 30/45 days when no refund policy gathered', () => {
      const prompt = buildCategoryPrompt('support_refund', makeEmptyContext())
      expect(prompt).toContain('within 30 days')
      expect(prompt).toContain('30-45 days')
      expect(prompt).toContain('over 45 days')
    })

    it('should use dynamic refund policy windows when available', () => {
      const ctx = makeEmptyContext()
      ctx.refundPolicy = {
        autoApproveWindowDays: 14,
        manualApproveWindowDays: 30,
      }
      const prompt = buildCategoryPrompt('support_refund', ctx)
      expect(prompt).toContain('within 14 days')
      expect(prompt).toContain('14-30 days')
      expect(prompt).toContain('over 30 days')
      // Should NOT contain the old hardcoded values
      expect(prompt).not.toContain('within 30 days')
    })

    it('should include special conditions when present', () => {
      const ctx = makeEmptyContext()
      ctx.refundPolicy = {
        autoApproveWindowDays: 30,
        manualApproveWindowDays: 45,
        specialConditions: [
          'Lifetime access: 60 day window',
          'Bundle purchases: each item refunded separately',
        ],
      }
      const prompt = buildCategoryPrompt('support_refund', ctx)
      expect(prompt).toContain('Special Conditions')
      expect(prompt).toContain('Lifetime access: 60 day window')
      expect(prompt).toContain('Bundle purchases')
    })

    it('should include policy URL when present', () => {
      const ctx = makeEmptyContext()
      ctx.refundPolicy = {
        autoApproveWindowDays: 30,
        manualApproveWindowDays: 45,
        policyUrl: 'https://example.com/refund-policy',
      }
      const prompt = buildCategoryPrompt('support_refund', ctx)
      expect(prompt).toContain('https://example.com/refund-policy')
    })

    it('should omit special conditions section when none exist', () => {
      const ctx = makeEmptyContext()
      ctx.refundPolicy = {
        autoApproveWindowDays: 30,
        manualApproveWindowDays: 45,
        specialConditions: [],
      }
      const prompt = buildCategoryPrompt('support_refund', ctx)
      expect(prompt).not.toContain('Special Conditions')
    })
  })

  // ────────────────────────────────────────────────────────────────────────
  // support_billing — dynamic invoice URL
  // ────────────────────────────────────────────────────────────────────────

  describe('support_billing prompt', () => {
    it('should fall back to totaltypescript.com when no appInfo gathered', () => {
      const prompt = buildCategoryPrompt('support_billing', makeEmptyContext())
      expect(prompt).toContain('https://www.totaltypescript.com/invoices')
    })

    it('should use dynamic invoice URL from appInfo', () => {
      const ctx = makeEmptyContext()
      ctx.appInfo = {
        name: 'Epic Web',
        instructorName: 'Kent C. Dodds',
        supportEmail: '[EMAIL]',
        websiteUrl: 'https://epicweb.dev',
        invoicesUrl: 'https://epicweb.dev/invoices',
      }
      const prompt = buildCategoryPrompt('support_billing', ctx)
      expect(prompt).toContain('https://epicweb.dev/invoices')
      expect(prompt).not.toContain('totaltypescript.com')
    })

    it('should fall back to default when appInfo has no invoicesUrl', () => {
      const ctx = makeEmptyContext()
      ctx.appInfo = {
        name: 'Some App',
        instructorName: 'Someone',
        supportEmail: '[EMAIL]',
        websiteUrl: 'https://app.com',
        // no invoicesUrl
      }
      const prompt = buildCategoryPrompt('support_billing', ctx)
      expect(prompt).toContain('https://www.totaltypescript.com/invoices')
    })

    it('should always contain billing instructions', () => {
      const prompt = buildCategoryPrompt('support_billing', makeEmptyContext())
      expect(prompt).toContain('Invoices are customizable')
      expect(prompt).toContain('PDFs are editable')
    })
  })

  // ────────────────────────────────────────────────────────────────────────
  // presales_faq — promotions/discount data
  // ────────────────────────────────────────────────────────────────────────

  describe('presales_faq prompt', () => {
    it('should not include promotions section when none available', () => {
      const prompt = buildCategoryPrompt('presales_faq', makeEmptyContext())
      expect(prompt).toContain('Presales FAQ')
      expect(prompt).not.toContain('Current Promotions')
    })

    it('should include promotions section when data is available', () => {
      const ctx = makeEmptyContext()
      ctx.activePromotions = [
        {
          id: 'promo-1',
          name: 'Holiday Sale',
          discountType: 'percent',
          discountAmount: 25,
          active: true,
          validUntil: '2025-01-01',
          code: 'HOLIDAY25',
        },
      ]
      const prompt = buildCategoryPrompt('presales_faq', ctx)
      expect(prompt).toContain('Current Promotions & Discounts')
      expect(prompt).toContain('Holiday Sale')
      expect(prompt).toContain('25% off')
      expect(prompt).toContain('HOLIDAY25')
      expect(prompt).toContain('until 2025-01-01')
    })

    it('should handle fixed-amount discounts', () => {
      const ctx = makeEmptyContext()
      ctx.activePromotions = [
        {
          id: 'promo-2',
          name: 'Fixed Discount',
          discountType: 'fixed',
          discountAmount: 5000, // $50.00 in cents
          active: true,
        },
      ]
      const prompt = buildCategoryPrompt('presales_faq', ctx)
      expect(prompt).toContain('$50.00 off')
    })

    it('should include conditions when present', () => {
      const ctx = makeEmptyContext()
      ctx.activePromotions = [
        {
          id: 'promo-3',
          name: 'PPP Discount',
          discountType: 'percent',
          discountAmount: 40,
          active: true,
          conditions: 'PPP — purchasing power parity',
        },
      ]
      const prompt = buildCategoryPrompt('presales_faq', ctx)
      expect(prompt).toContain('PPP — purchasing power parity')
    })

    it('should handle empty promotions array (no section)', () => {
      const ctx = makeEmptyContext()
      ctx.activePromotions = []
      const prompt = buildCategoryPrompt('presales_faq', ctx)
      expect(prompt).not.toContain('Current Promotions')
    })

    it('should handle multiple promotions', () => {
      const ctx = makeEmptyContext()
      ctx.activePromotions = [
        {
          id: 'p1',
          name: 'Sale A',
          discountType: 'percent',
          discountAmount: 10,
          active: true,
        },
        {
          id: 'p2',
          name: 'Sale B',
          discountType: 'percent',
          discountAmount: 20,
          active: true,
          code: 'SAVEBIG',
        },
      ]
      const prompt = buildCategoryPrompt('presales_faq', ctx)
      expect(prompt).toContain('Sale A')
      expect(prompt).toContain('Sale B')
      expect(prompt).toContain('10% off')
      expect(prompt).toContain('20% off')
      expect(prompt).toContain('SAVEBIG')
    })
  })

  // ────────────────────────────────────────────────────────────────────────
  // presales_team — license/seat data
  // ────────────────────────────────────────────────────────────────────────

  describe('presales_team prompt', () => {
    it('should not include license section when no data available', () => {
      const prompt = buildCategoryPrompt('presales_team', makeEmptyContext())
      expect(prompt).toContain('Team/Enterprise Inquiries')
      expect(prompt).not.toContain('License & Seat Data')
    })

    it('should include license section when data is available', () => {
      const ctx = makeEmptyContext()
      ctx.licenseInfo = [
        {
          purchaseId: 'pur-123',
          licenseType: 'team',
          totalSeats: 10,
          claimedSeats: 7,
          availableSeats: 3,
          claimedBy: [],
          adminEmail: '[EMAIL]',
        },
      ]
      const prompt = buildCategoryPrompt('presales_team', ctx)
      expect(prompt).toContain('License & Seat Data')
      expect(prompt).toContain('team')
      expect(prompt).toContain('7/10')
      expect(prompt).toContain('3 available')
      expect(prompt).toContain('[EMAIL]')
    })

    it('should include expiry when present', () => {
      const ctx = makeEmptyContext()
      ctx.licenseInfo = [
        {
          purchaseId: 'pur-456',
          licenseType: 'enterprise',
          totalSeats: 50,
          claimedSeats: 20,
          availableSeats: 30,
          claimedBy: [],
          expiresAt: '2025-12-31',
        },
      ]
      const prompt = buildCategoryPrompt('presales_team', ctx)
      expect(prompt).toContain('2025-12-31')
    })

    it('should handle empty license array (no section)', () => {
      const ctx = makeEmptyContext()
      ctx.licenseInfo = []
      const prompt = buildCategoryPrompt('presales_team', ctx)
      expect(prompt).not.toContain('License & Seat Data')
    })

    it('should handle multiple licenses', () => {
      const ctx = makeEmptyContext()
      ctx.licenseInfo = [
        {
          purchaseId: 'pur-1',
          licenseType: 'team',
          totalSeats: 5,
          claimedSeats: 5,
          availableSeats: 0,
          claimedBy: [],
        },
        {
          purchaseId: 'pur-2',
          licenseType: 'enterprise',
          totalSeats: 100,
          claimedSeats: 50,
          availableSeats: 50,
          claimedBy: [],
        },
      ]
      const prompt = buildCategoryPrompt('presales_team', ctx)
      expect(prompt).toContain('5/5')
      expect(prompt).toContain('50/100')
    })
  })

  // ────────────────────────────────────────────────────────────────────────
  // Static category prompts (no dynamic data)
  // ────────────────────────────────────────────────────────────────────────

  describe('static category prompts', () => {
    it('should return access prompt for support_access', () => {
      const prompt = buildCategoryPrompt('support_access', makeEmptyContext())
      expect(prompt).toContain('Access Issues')
      expect(prompt).toContain('magic link')
    })

    it('should return transfer prompt for support_transfer', () => {
      const prompt = buildCategoryPrompt('support_transfer', makeEmptyContext())
      expect(prompt).toContain('Transfer Requests')
      expect(prompt).toContain('current email')
    })

    it('should return technical prompt for support_technical', () => {
      const prompt = buildCategoryPrompt(
        'support_technical',
        makeEmptyContext()
      )
      expect(prompt).toContain('Technical Questions')
      expect(prompt).toContain('knowledge base')
    })

    it('should return base prompt for unknown category', () => {
      const prompt = buildCategoryPrompt('unknown', makeEmptyContext())
      expect(prompt).toContain('support agent')
      expect(prompt).not.toContain('Access Issues')
      expect(prompt).not.toContain('Refund Requests')
    })
  })

  // ────────────────────────────────────────────────────────────────────────
  // Graceful handling of missing/null data
  // ────────────────────────────────────────────────────────────────────────

  describe('graceful missing data handling', () => {
    it('should handle null refundPolicy without crashing', () => {
      const ctx = makeEmptyContext()
      ctx.refundPolicy = null
      const prompt = buildCategoryPrompt('support_refund', ctx)
      // Falls back to defaults
      expect(prompt).toContain('within 30 days')
    })

    it('should handle undefined refundPolicy without crashing', () => {
      const ctx = makeEmptyContext()
      // refundPolicy is undefined by default
      const prompt = buildCategoryPrompt('support_refund', ctx)
      expect(prompt).toContain('within 30 days')
    })

    it('should handle null appInfo for billing without crashing', () => {
      const ctx = makeEmptyContext()
      ctx.appInfo = null
      const prompt = buildCategoryPrompt('support_billing', ctx)
      // Falls back to default URL
      expect(prompt).toContain('totaltypescript.com/invoices')
    })

    it('should handle null activePromotions without crashing', () => {
      const ctx = makeEmptyContext()
      ctx.activePromotions = null
      const prompt = buildCategoryPrompt('presales_faq', ctx)
      expect(prompt).toContain('Presales FAQ')
      expect(prompt).not.toContain('Current Promotions')
    })

    it('should handle null licenseInfo without crashing', () => {
      const ctx = makeEmptyContext()
      ctx.licenseInfo = null
      const prompt = buildCategoryPrompt('presales_team', ctx)
      expect(prompt).toContain('Team/Enterprise Inquiries')
      expect(prompt).not.toContain('License & Seat Data')
    })

    it('should handle all SDK data being null simultaneously', () => {
      const ctx = makeEmptyContext()
      ctx.refundPolicy = null
      ctx.appInfo = null
      ctx.activePromotions = null
      ctx.licenseInfo = null
      ctx.contentAccess = null
      ctx.recentActivity = null

      // All prompts should work with null data
      expect(() => buildCategoryPrompt('support_refund', ctx)).not.toThrow()
      expect(() => buildCategoryPrompt('support_billing', ctx)).not.toThrow()
      expect(() => buildCategoryPrompt('presales_faq', ctx)).not.toThrow()
      expect(() => buildCategoryPrompt('presales_team', ctx)).not.toThrow()
    })
  })

  // ────────────────────────────────────────────────────────────────────────
  // All prompts include base prompt
  // ────────────────────────────────────────────────────────────────────────

  describe('all prompts include base prompt', () => {
    const categories = [
      'support_access',
      'support_refund',
      'support_transfer',
      'support_billing',
      'support_technical',
      'presales_faq',
      'presales_team',
      'unknown',
    ] as const

    it.each(categories)('should include base prompt for %s', (category) => {
      const prompt = buildCategoryPrompt(category, makeEmptyContext())
      expect(prompt).toContain('You are a support agent')
      expect(prompt).toContain('Style Guide')
    })
  })
})
