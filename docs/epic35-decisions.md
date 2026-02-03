# Epic 3.5 Agent Actions — Decision Record

**Date:** 2026-02-02
**Decided by:** Joel Hooks

## Action Authorization Matrix

| Action | Authorization | Conditions |
|--------|--------------|------------|
| Magic login link | ❌ **Skip** | Just send to login page; magic links are admin-only |
| Resend access email | ❌ **Skip** | We don't do this |
| Process refund | ✅ **Auto** | Single purchase, ≤30 days, <$100 |
| Process refund | 🔶 **Escalate** | >$100 OR >30 days OR bundles/teams |
| Transfer license | ✅ **Auto** | Same user context (obvious transfer) |
| Transfer license | 🔶 **Escalate** | Unclear user relationship |
| Custom invoice | ⏸️ **Skip** | No backend yet |
| Stripe quote | ✅ **Auto** | Obvious/standard request |
| Stripe quote | 🔶 **Escalate** | Complex/custom requirements |

## Thresholds

- **Refund auto-approve:** <$100 AND ≤30 days AND single purchase
- **Refund escalate:** ≥$100 OR >30 days OR bundles/teams

## Current Stripe Wiring (in SDK)

**Already available:**
- `processRefund` — request refund via SDK
- `lookupCharge` — look up charge details
- `getPaymentHistory` — payment history
- `getSubscriptionStatus` — subscription status
- `verifyRefund` — verify refund completed
- `getLicenseInfo` — license details

**Needs implementation:**
- `transferLicense` — SDK endpoint needed
- `createStripeQuote` — SDK endpoint needed

## License Transfer Architecture

- **course-builder apps:** Use transfer database table
- **skillrecordings products:** Email change on purchase record
- **Pattern:** Agent requests via SDK → App executes transfer

## Implementation Priority

1. **Refunds** — Already wired, just needs authorization logic
2. **Transfer license** — Needs SDK endpoint, then tool
3. **Stripe quotes** — Needs SDK endpoint, then tool
