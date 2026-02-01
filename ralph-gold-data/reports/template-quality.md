# Template Quality Report

Generated: 2026-01-31T21:52:12.591Z
Total Templates: 55

## Summary by Category

| Category | Count | Avg Confidence | With Variables |
|----------|-------|----------------|----------------|
| support_technical | 14 | 84% | 11 |
| support_access | 10 | 85% | 9 |
| support_refund | 10 | 88% | 9 |
| presales_faq | 7 | 87% | 5 |
| support_billing | 5 | 80% | 3 |
| fan_mail | 3 | 97% | 1 |
| support_transfer | 3 | 83% | 2 |
| spam | 2 | 90% | 0 |
| presales_consult | 1 | 80% | 1 |

## Confidence Distribution

- High (≥90%): 34
- Medium (70-89%): 21
- Low (<70%): 0

## Variable Usage

- `{{name}}`: 9 templates
- `{{customer_name}}`: 9 templates
- `{{email}}`: 6 templates
- `{{product_name}}`: 3 templates
- `{{undefined}}`: 3 templates
- `{{course_name}}`: 2 templates
- `{{instructor}}`: 2 templates
- `{{order_id}}`: 2 templates
- `{{order_date}}`: 2 templates
- `{{company}}`: 1 templates
- `{{coupon_link}}`: 1 templates
- `{{code}}`: 1 templates
- `{{browser}}`: 1 templates
- `{{sender}}`: 1 templates
- `{{purchase_date}}`: 1 templates
- `{{purchase_id}}`: 1 templates
- `{{purchase_amount}}`: 1 templates
- `{{email_1}}`: 1 templates
- `{{email_2}}`: 1 templates
- `{{date}}`: 1 templates
- `{{training}}`: 1 templates
- `{{vat_number}}`: 1 templates
- `{{ein}}`: 1 templates
- `{{discount_code}}`: 1 templates
- `{{original_price}}`: 1 templates
- `{{new_price}}`: 1 templates
- `{{amount}}`: 1 templates
- `{{customer_email}}`: 1 templates
- `{{invoice_id}}`: 1 templates
- `{{customer_message}}`: 1 templates
- `{{product}}`: 1 templates
- `{{phone}}`: 1 templates
- `{{bundle_essentials}}`: 1 templates
- `{{bundle_complete}}`: 1 templates

## Sample Templates (Top 3 per Category)

### support_technical

**Pattern:** customer request for information about integrating AI into their workflow

> Since this is a direct request from you about integrating AI, I'd recommend replying directly to {{email}} so they can assist you further. I'd be happy to help if you have any other questions, but for...

Confidence: 90%

---

**Pattern:** Getting started with TypeScript

> Great! If you're just starting out with TypeScript, I'd recommend beginning with the fundamentals:
> 
> - Learn how TypeScript differs from JavaScript, type annotations, interfaces, and basic types. Work ...

Confidence: 90%

---

**Pattern:** customer needs help with TypeScript

> I'm sorry to hear you're having trouble with TypeScript. What specific part is giving you trouble? I'd be happy to point you in the right direction. TypeScript is a powerful language, and with a bit o...

Confidence: 90%

---

### support_access

**Pattern:** Customer has purchased a course but is having trouble accessing it

> Hi {{customer_name}},
> 
> Thanks for reaching out. I'd be happy to help you access the Total TypeScript course you purchased.
> 
> Can you please confirm the email address you used to make the purchase? I ca...

Confidence: 90%

---

**Pattern:** missing Zoom link for scheduled event

> No need to worry. The confirmation email you received mentioned the Zoom link would come in a separate email. If you got the calendar invite but it's missing the Zoom link, check your inbox for anothe...

Confidence: 90%

---

**Pattern:** request for refund for recent purchase

> I'm running into a technical issue pulling up your account. Can you please provide the {{purchase_date}}, {{purchase_id}}, and {{purchase_amount}} or {{product_name}} so I can process the refund for y...

Confidence: 90%

---

### support_refund

**Pattern:** request for refund on unused order

> Hello,
> 
> We've initiated a refund for order {{order_id}} placed on {{order_date}}. It can take 5-10 days for the banks to reconcile and return the money to your account {{email}}.

Confidence: 90%

---

**Pattern:** request for a refund or discount to match a previous promotion

> Thank you for reaching out about your order. While we are unable to provide a refund for the full price, we would be happy to offer you a coupon code that will reduce the price to the previously disco...

Confidence: 90%

---

**Pattern:** request for refund due to training mismatch

> We've initiated a refund for your purchase. It can take 5-10 days for the banks to process the refund and return the money to your account. Please let us know if you have any other questions.

Confidence: 90%

---

### presales_faq

**Pattern:** Customer missed a discount and wants to still purchase the product

> Hi {{name}},
> 
> I've extended the coupon for you! This is valid for another week: {{coupon_link}}
> 
> Let me know if you have any other questions!

Confidence: 90%

---

**Pattern:** personal correspondence between customer and AI hero team member

> Looks like this message is personal correspondence between you and a member of the AI Hero team. I'm unable to draft a response as this isn't a support request. The AI Hero team will need to review th...

Confidence: 90%

---

**Pattern:** Asking about recording availability for a live workshop

> Hey {{name}},
> Good question on the recording. That's something {{instructor}} would need to confirm directly, since workshop setup details can vary. I'd suggest replying to this email chain to ask {{h...

Confidence: 90%

---

### support_billing

**Pattern:** customer requests VAT number for invoice

> We're a US-based company, so we don't have a VAT number. However, we can provide our EIN or issue a standard receipt/invoice for you to use. Please let me know if you need anything else!

Confidence: 90%

---

**Pattern:** request for applying a discount to a past purchase

> Hey {{name}},
> 
> No problem! This coupon gives you 50% off: {{discount_code}}
> 
> Let me know if you need anything else.

Confidence: 90%

---

**Pattern:** Inquiring about price increase and promo codes for Total TypeScript Pro course

> Thank you for your inquiry about the Total TypeScript Pro course pricing. We recently had to increase the price from $397.50 to $750, but we do offer various coupon codes and discounts that may be app...

Confidence: 80%

---

### fan_mail

**Pattern:** personal correspondence to an individual

> Thank you for reaching out. This appears to be personal correspondence intended for Matt directly. Since there's no instructor routing configured, I'll need to forward this manually to ensure Matt see...

Confidence: 100%

---

**Pattern:** personal correspondence to employee

> I'm afraid I can't route this directly to Matt, as this appears to be personal correspondence that should go to him directly rather than support. Please forward this conversation to Matt, as Tasos is ...

Confidence: 100%

---

**Pattern:** request for refund on TypeScript course

> Hello, we've initiated a refund for your purchase of the {{course_name}}. It can take 5-10 days for the banks to reconcile and return the money to your account.

Confidence: 90%

---

### support_transfer

**Pattern:** inquiry about upgrading a purchase to a larger course bundle

> Yes! If you purchase the *TypeScript Pro Essentials* bundle now, you'll be able to upgrade to the *TypeScript Pro Complete* bundle later by paying only the difference in price. We prorate what you pai...

Confidence: 90%

---

**Pattern:** request to transfer a license from a deactivated company email

> Hi there, I'd be happy to help with that. Since the original account was tied to a company email that has been deactivated, the best way to transfer the license is to provide us with {{customer_name}}...

Confidence: 90%

---

**Pattern:** transfer course to [email]

> Thank you for following up on the course license transfer. I have processed the transfer to [EMAIL]. Please let me know if you need anything else.

Confidence: 70%

---

### spam

**Pattern:** casual message without support request

> This appears to be a casual message without an actual support request. If you have any questions or issues related to our product, please reach out and we'll be happy to assist.

Confidence: 90%

---

**Pattern:** spam email with unsubscribe link

> I'm not able to assist with this type of message. This appears to be a personal outreach from the instructor, Matt, to learn more about your interests in AI. I'll make sure he sees your response.

Confidence: 90%

---

### presales_consult

**Pattern:** Request for a workshop on AI usage with Claude Code

> Thank you for your interest in a workshop on AI usage with Claude Code. I would be happy to discuss the possibility of offering a workshop for your engineers. Please let me know if you have any additi...

Confidence: 80%

---

## Templates Needing Review

- **customer requesting refund for duplicate license**: Contains undefined/unknown variable
- **I can't figure out TypeScript. AI has stolen my job. Now i sack groceries. Help!**: Contains undefined/unknown variable
