# Gold Data Pipeline - Agent Context

## Goal
Transform noisy support conversation data into a gold-standard database for generating reply templates.
Align with production classification taxonomy already running in the support agent.

## Data Sources

**Primary:** `../packages/cli/data/merged-conversations.json`
- Has `source` field populated (total-typescript, ai-hero)
- 196 conversations (100 TT + 96 AI Hero from earlier check)

**Conversation Schema:**
```typescript
{
  id: string,
  conversationId: string,
  subject: string,
  customerEmail: string,
  status: string,
  tags: string[],               // Existing: "delete account", "refund request", etc.
  triggerMessage: { id, subject, body, timestamp },
  conversationHistory: [{ direction: 'in'|'out', body, timestamp }],
  category: string,             // Broad category
  source: string                // Product: "total-typescript", "ai-hero"
}
```

## Production Classification Taxonomy

**Use these exact categories** (from `packages/core/src/pipeline/steps/classify.ts`):

### Support Categories (customer has existing purchase)
- `support_access` — Can't login, license problems, account access
- `support_refund` — Wants money back (30-day policy)
- `support_transfer` — Move purchase to different email
- `support_technical` — Course content questions, code help
- `support_billing` — Invoice/receipt requests, tax documents

### Presales Categories (BEFORE purchase)
- `presales_faq` — Simple questions (pricing, curriculum, PPP, discounts)
- `presales_consult` — Needs instructor judgment ("which course?")
- `presales_team` — Enterprise/team/bulk inquiries

### Non-Support Categories
- `fan_mail` — PURE unsolicited appreciation (rare, no asks)
- `spam` — Vendor outreach, partnership pitches, affiliate offers
- `system` — Automated replies, bounces
- `voc_response` — Reply to our automated outreach emails

### Thread State Categories (for routing, less useful for templates)
- `resolved` — Customer confirmed issue fixed
- `awaiting_customer` — We asked, waiting for reply
- `instructor_strategy` — Internal thread
- `unknown` — Can't categorize

## Course Builder Self-Serve

Course Builder has a 7-day transfer mechanism (`packages/core/src/lib/actions/transfer-purchase.ts`).
Users can self-serve email changes → should see fewer `support_transfer` tickets on Course Builder apps.

**Hypothesis to validate:** 
`support_transfer` rate: Course Builder << Total TypeScript

## Quality Criteria for Templates

Gold conversations should have:
1. **Customer <-> Human support agent** (not auto-replies)
2. **Clear resolution** — Issue fully resolved
3. **Good outcome** — Customer satisfied
4. **Template-worthy** — Response pattern is reusable
5. **Professional tone** — No awkward exchanges

Skip:
- Auto-replies only (system, awaiting_customer)
- Spam/vendor outreach
- Fan mail (no response needed)
- Unresolved threads

## File Structure
```
ralph-gold-data/
├── gold.duckdb          # Clean database
├── schemas/gold.sql     # Schema definition
├── scripts/             # Bun/TypeScript scripts
├── reports/             # Analytics output
├── prd.json             # Ralph stories
└── progress.txt         # Iteration log
```

## Reference Code
- Classification: `packages/core/src/pipeline/steps/classify.ts`
- DB Schema: `packages/database/src/schema.ts`
- Transfer: `course-builder/packages/core/src/lib/actions/transfer-purchase.ts`
