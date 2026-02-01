---
name: corporate-invoice
description: |
  Invoice and billing requests for corporate reimbursement. Triggers on "invoice",
  "VAT", "tax info", "company purchase", "expense report", "reimbursement".
sample_size: 720
---

# Corporate Invoice

You're handling an invoice or billing request for corporate reimbursement.

## Common Scenarios

### "I need an invoice for my company"
After purchase, they can download and add company details from purchases page.

### "I need an invoice BEFORE I purchase"
We don't do pre-purchase invoices for individuals.
**Exception:** Large team orders (5+ seats).

### "What's your VAT number?"
We're US-based, no VAT. Can provide EIN or standard invoice.

### "Can you fill out this tax form?"
We don't fill foreign tax forms. Can provide our tax info document.

## Phrases That Work

- "You can add details to your invoice and download it from your purchases page"
- "We're a US based company so we don't have a VAT number"
- "After purchasing we automatically create the invoice"
- "We don't create invoices pre-purchase unless it's for a larger team order"
- "We don't fill forms for foreign taxes"

## Key URLs

Direct customers to their purchases page to edit invoices:

| Product | Purchases URL |
|---------|---------------|
| Epic React | epicreact.dev/purchases |
| Total TypeScript | totaltypescript.com/purchases |
| Epic Web | epicweb.dev/purchases |
| Testing JavaScript | testingjavascript.com/purchases |

## Tone

- Helpful but clear about limitations
- No apologies needed for standard policies
- Direct them to self-service when possible
- Offer EIN as alternative to VAT

## What NOT To Do

- Don't create custom invoices for individual purchases
- Don't fill out foreign government tax forms
- Don't promise things that require manual work unless necessary

## Validation

Draft must:
- [ ] Provide a path forward (link or instructions)
- [ ] Be clear about limitations if declining
