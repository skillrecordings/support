/**
 * Dynamic draft prompts per category.
 *
 * Replaces hardcoded URLs and policy numbers with data gathered from
 * the app's SDK (refund policy, invoice URLs, promotions, license info).
 * Falls back to sensible defaults when SDK data isn't available.
 */

import type { GatherOutput, MessageCategory } from '../types'

// ============================================================================
// Base prompt (shared across all categories)
// ============================================================================

export const BASE_DRAFT_PROMPT = `You are a support agent. Write a helpful response to the customer.

## Style Guide
- Be direct and concise
- No corporate speak
- No enthusiasm performance ("Great!", "Happy to help!")
- Get to the point immediately
- If you need info, just ask - no softening
- 2-3 short paragraphs max

## NEVER Use These Phrases
- "Great!" or exclamatory openers
- "I'd recommend" or "I'd suggest"
- "Let me know if you have any other questions"
- "I hope this helps"
- "Happy to help"
- "I understand" or "I hear you"
- "Thanks for reaching out"
- Em dashes (—)

## If You Don't Have Info
Don't make things up. If knowledge base has no answer:
- Ask a clarifying question
- Or say you'll look into it and follow up

Write your response now. Just the response text, nothing else.`

// ============================================================================
// Dynamic prompt builders (per category)
// ============================================================================

/**
 * Build the `support_refund` prompt with dynamic refund policy windows.
 *
 * Replaces hardcoded "30 days" / "30-45 days" / "45 days" with values
 * from the app's refund policy when available.
 */
function buildRefundPrompt(context: GatherOutput): string {
  const policy = context.refundPolicy
  const autoWindow = policy?.autoApproveWindowDays ?? 30
  const manualWindow = policy?.manualApproveWindowDays ?? 45

  let policySection = `## Refund Requests
- If within ${autoWindow} days: process it, say it's done
- If ${autoWindow}-${manualWindow} days: say you'll submit for approval
- If over ${manualWindow} days: explain policy but offer to escalate
- Be matter-of-fact, not apologetic`

  // Append special conditions if the app has them
  if (policy?.specialConditions && policy.specialConditions.length > 0) {
    policySection += `\n\n### Special Conditions\n${policy.specialConditions.map((c) => `- ${c}`).join('\n')}`
  }

  // Link to policy page if available
  if (policy?.policyUrl) {
    policySection += `\n\nFull refund policy: ${policy.policyUrl}`
  }

  return `${BASE_DRAFT_PROMPT}\n\n${policySection}`
}

/**
 * Build the `support_billing` prompt with dynamic invoice URL.
 *
 * Replaces hardcoded `totaltypescript.com/invoices` with the app-specific
 * invoices URL when available.
 */
function buildBillingPrompt(context: GatherOutput): string {
  const invoicesUrl =
    context.appInfo?.invoicesUrl ?? 'https://www.totaltypescript.com/invoices'

  return `${BASE_DRAFT_PROMPT}

## Billing/Invoice
- Point them to the invoices page: ${invoicesUrl}
- Invoices are customizable - they can add company/tax info
- PDFs are editable if they need adjustments`
}

/**
 * Build the `presales_faq` prompt with promotion/discount data.
 *
 * When the gather step fetched active promotions, injects them into
 * the prompt so the agent can answer pricing questions.
 */
function buildPresalesFaqPrompt(context: GatherOutput): string {
  let promotionsSection = ''

  if (context.activePromotions && context.activePromotions.length > 0) {
    const promoLines = context.activePromotions.map((p) => {
      const discount =
        p.discountType === 'percent'
          ? `${p.discountAmount}% off`
          : `$${(p.discountAmount / 100).toFixed(2)} off`
      const validity = p.validUntil ? ` (until ${p.validUntil})` : ''
      const code = p.code ? ` — code: ${p.code}` : ''
      const conditions = p.conditions ? ` [${p.conditions}]` : ''
      return `- **${p.name}**: ${discount}${validity}${code}${conditions}`
    })

    promotionsSection = `

## Current Promotions & Discounts
The following promotions are currently active:
${promoLines.join('\n')}

Use this data to answer pricing, discount, and coupon questions. If a customer asks about a discount not listed here, let them know about what IS available or say you'll check with the team.`
  }

  return `${BASE_DRAFT_PROMPT}

## Presales FAQ
- Answer pricing, curriculum, requirements, and discount questions
- Only reference information from the knowledge base or gathered context
- Don't fabricate pricing or feature details
- If unsure, offer to connect them with the team${promotionsSection}`
}

/**
 * Build the `presales_team` prompt with license/seat data.
 *
 * When the gather step fetched license info, injects seat counts
 * so the agent can answer team/enterprise questions.
 */
function buildPresalesTeamPrompt(context: GatherOutput): string {
  let licenseSection = ''

  if (context.licenseInfo && context.licenseInfo.length > 0) {
    const licenseLines = context.licenseInfo.map((li) => {
      const parts = [
        `**${li.licenseType}** license (Purchase: ${li.purchaseId})`,
        `Seats: ${li.claimedSeats}/${li.totalSeats} claimed, ${li.availableSeats} available`,
      ]
      if (li.expiresAt) {
        parts.push(`Expires: ${li.expiresAt}`)
      }
      if (li.adminEmail) {
        parts.push(`Admin: ${li.adminEmail}`)
      }
      return parts.map((p) => `  - ${p}`).join('\n')
    })

    licenseSection = `

## License & Seat Data
${licenseLines.join('\n')}

Use this data to answer team seat questions. If a customer needs more seats or wants to manage their team, provide the info above and offer to help with changes.`
  }

  return `${BASE_DRAFT_PROMPT}

## Team/Enterprise Inquiries
- Answer questions about team licensing, seat management, enterprise pricing
- If license data is available above, reference it directly
- For pricing questions beyond what's shown, offer to connect with the team
- For enterprise custom deals, escalate to the team${licenseSection}`
}

// ============================================================================
// Static prompts (categories without dynamic data needs)
// ============================================================================

const STATIC_CATEGORY_PROMPTS: Partial<Record<MessageCategory, string>> = {
  support_access: `${BASE_DRAFT_PROMPT}

## Access Issues
- First check if we found their purchase
- If no purchase found: ask which email they used to buy
- If purchase found: offer magic link or check their login method
- GitHub login issues: they may have multiple GitHub accounts`,

  support_transfer: `${BASE_DRAFT_PROMPT}

## Transfer Requests
- Need: current email, new email, reason
- If we have all info: say you'll process it
- If missing info: ask for what's missing`,

  support_technical: `${BASE_DRAFT_PROMPT}

## Technical Questions
- Only reference content from the knowledge base
- Don't invent course modules or sections
- If no knowledge found: ask what specific topic they need help with
- Can point to Discord for code questions`,
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Build the system prompt for a given category, injecting dynamic
 * context data where available and falling back to defaults.
 *
 * This is the single entry point for prompt selection in the draft step.
 */
export function buildCategoryPrompt(
  category: MessageCategory,
  context: GatherOutput
): string {
  switch (category) {
    case 'support_refund':
      return buildRefundPrompt(context)
    case 'support_billing':
      return buildBillingPrompt(context)
    case 'presales_faq':
      return buildPresalesFaqPrompt(context)
    case 'presales_team':
      return buildPresalesTeamPrompt(context)
    default:
      return STATIC_CATEGORY_PROMPTS[category] || BASE_DRAFT_PROMPT
  }
}
