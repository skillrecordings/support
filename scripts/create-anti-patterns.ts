#!/usr/bin/env bun

import * as fs from 'node:fs/promises'
import * as path from 'node:path'

const SKILLS_DIR = path.join(process.cwd(), 'skills')

// Top 10 skills by sample size
const TOP_SKILLS = [
  'email-change',           // 2920
  'refund-request',         // 1433
  'login-link',             // 999
  'access-locked-out',      // 878
  'corporate-invoice',      // 720
  'ppp-pricing',            // 715
  'technical-issue-course-content', // 596
  'pricing-inquiry',        // 523
  'course-content-locked',  // 520
  'team-license-purchase',  // 508
]

const ANTI_PATTERNS: Record<string, string> = {
  'email-change': `# Anti-Patterns for Email Change

## Anti-Pattern: Asking for Unnecessary Verification

❌ **BAD:**
"Can you please provide the last 4 digits of your credit card, your birthday, and the exact date you purchased the course to verify your identity?"

✅ **GOOD:**
"I'll send a verification link to both your old and new email addresses. Just click confirm on both to complete the transfer."

**Why it's wrong:** We don't need extensive identity verification for email changes. A simple double-opt-in to both emails is sufficient and less friction.

---

## Anti-Pattern: Manual License Transfer Promise

❌ **BAD:**
"I'll manually transfer your license in the next 24-48 hours. Please wait for confirmation."

✅ **GOOD:**
"I've updated your email from old@email.com to new@email.com. You can now log in with your new email using this link: [login link]"

**Why it's wrong:** Customers expect immediate resolution. If it requires manual work, do it now and confirm completion.

---

## Anti-Pattern: Asking Which Course

❌ **BAD:**
"Which course did you purchase?"

✅ **GOOD:**
"I can see you have access to Total TypeScript and Pro Tailwind. I'll update the email for both. Here's your new login link..."

**Why it's wrong:** We can look this up. Don't make customers do work we can do ourselves.`,

  'refund-request': `# Anti-Patterns for Refund Request

## Anti-Pattern: Explaining the Refund Policy First

❌ **BAD:**
"Per our refund policy, refunds are available within 30 days of purchase. Your purchase was on [date]. Since this is within the refund window, I can process your refund."

✅ **GOOD:**
"Refund initiated! You'll see it in your account within 5-10 business days. Sorry the course wasn't the right fit."

**Why it's wrong:** If they're asking for a refund and it's within policy, just do it. Don't lecture about policy first.

---

## Anti-Pattern: Asking Why They Want a Refund

❌ **BAD:**
"Can you tell me more about why you'd like a refund? We'd love to understand what didn't work for you."

✅ **GOOD:**
"Done! Refund is on its way. If there was something specific that didn't work, I'd love to hear it - but no pressure."

**Why it's wrong:** Requiring justification before processing creates friction and feels interrogative.

---

## Anti-Pattern: Forgetting the Timeline

❌ **BAD:**
"I've processed your refund."

✅ **GOOD:**
"Refund processed! It typically takes 5-10 business days for banks to reconcile, but you should see it soon."

**Why it's wrong:** Customers will follow up asking "where's my refund?" if you don't set expectations.`,

  'login-link': `# Anti-Patterns for Login Link

## Anti-Pattern: Over-Explaining the System

❌ **BAD:**
"Our system uses magic links instead of passwords. When you request a login, we send a secure, time-limited link to your email. This link is unique to you and expires after 24 hours for security reasons. Click the link to access your account."

✅ **GOOD:**
"Login link sent! Check your email (and spam folder). Link expires in 24h."

**Why it's wrong:** They just want to log in. Technical explanations don't help.

---

## Anti-Pattern: Not Checking Spam

❌ **BAD:**
"I've sent you a new login link."

✅ **GOOD:**
"Sent! If you don't see it in a few minutes, check your spam folder - sometimes email filters catch our messages."

**Why it's wrong:** This is the #1 reason people don't get emails. Always mention spam.

---

## Anti-Pattern: Wrong Email Assumption

❌ **BAD:**
"Login link sent to your email!"

✅ **GOOD:**
"Login link sent to j***@example.com. Is that the right email?"

**Why it's wrong:** They might have purchased with a different email than they're checking.`,

  'access-locked-out': `# Anti-Patterns for Access Locked Out

## Anti-Pattern: Asking Them to "Try Again"

❌ **BAD:**
"Please try logging in again and let me know if it still doesn't work."

✅ **GOOD:**
"Looks like your access expired because [reason]. I've restored it - here's your login link: [link]"

**Why it's wrong:** They already tried. They need you to fix it, not try again.

---

## Anti-Pattern: Not Explaining Why

❌ **BAD:**
"I've restored your access."

✅ **GOOD:**
"Your access was locked because your payment method expired. I've unlocked it and extended for 30 days while you update your payment info."

**Why it's wrong:** Without context, it might happen again. Help them prevent recurrence.

---

## Anti-Pattern: Policy-First Response

❌ **BAD:**
"Access to our courses requires an active subscription. Your subscription ended on [date]..."

✅ **GOOD:**
"Got you back in! Your subscription had lapsed but I've reactivated it. Here's your login: [link]"

**Why it's wrong:** Lead with the solution, not the policy.`,

  'corporate-invoice': `# Anti-Patterns for Corporate Invoice

## Anti-Pattern: Missing Required Fields

❌ **BAD:**
"Here's your invoice!" (sends basic receipt)

✅ **GOOD:**
"Here's your invoice with company name, address, and VAT/tax ID as requested. Let me know if your finance team needs any fields adjusted."

**Why it's wrong:** Corporate invoices need specific info for reimbursement/accounting.

---

## Anti-Pattern: Not Offering Bulk Options

❌ **BAD:**
"I've sent the invoice for your individual purchase."

✅ **GOOD:**
"Invoice attached! By the way, if your company is interested in team licenses (5+ seats), we offer volume pricing - let me know if you'd like details."

**Why it's wrong:** Corporate requests often indicate team interest. Opportunity to upsell appropriately.

---

## Anti-Pattern: Long Wait Times

❌ **BAD:**
"I'll generate this invoice and send it within 2-3 business days."

✅ **GOOD:**
"Invoice attached! Let me know if you need any changes for your reimbursement."

**Why it's wrong:** Invoices should be immediate. Finance deadlines are often tight.`,

  'ppp-pricing': `# Anti-Patterns for PPP Pricing

## Anti-Pattern: Requiring Proof

❌ **BAD:**
"To qualify for PPP pricing, please send proof of residence such as a utility bill or government ID."

✅ **GOOD:**
"Your PPP discount is automatically applied based on your location. Use code XXXXX at checkout for your regional pricing."

**Why it's wrong:** We use IP geolocation. Don't make people prove they're poor.

---

## Anti-Pattern: Explaining the Economics

❌ **BAD:**
"PPP pricing is designed to make our content accessible in regions where the standard USD price would be prohibitively expensive relative to local purchasing power..."

✅ **GOOD:**
"Here's your regional pricing: [discounted price]. Use code [code] at checkout!"

**Why it's wrong:** They know why they need it. Just give them the discount.

---

## Anti-Pattern: Suspicion

❌ **BAD:**
"I see you're requesting PPP pricing but your IP suggests you're in the US..."

✅ **GOOD:**
"Happy to help! If you're not seeing regional pricing automatically, try disabling your VPN or use code [code] directly."

**Why it's wrong:** VPNs exist. Don't accuse customers of fraud.`,

  'technical-issue-course-content': `# Anti-Patterns for Technical Issues

## Anti-Pattern: Generic Troubleshooting First

❌ **BAD:**
"Please try clearing your cache, using a different browser, and disabling extensions. Let me know if that helps."

✅ **GOOD:**
"That video playback issue is a known bug we're fixing. For now, try this workaround: [specific steps]. We'll have it fixed by [timeframe]."

**Why it's wrong:** If it's a known issue, say so. Don't make them troubleshoot what you already know is broken.

---

## Anti-Pattern: Not Acknowledging the Bug

❌ **BAD:**
"I'm not able to reproduce this issue. Can you send a screenshot?"

✅ **GOOD:**
"Thanks for reporting this! I've logged it for our team. In the meantime, here's a workaround..."

**Why it's wrong:** "I can't reproduce" feels dismissive. Acknowledge and help regardless.

---

## Anti-Pattern: No Workaround Offered

❌ **BAD:**
"Our team is aware of this issue and working on a fix."

✅ **GOOD:**
"Known issue! While we fix it, you can [workaround]. I'll email you when the fix is live."

**Why it's wrong:** "Working on it" with no timeline or workaround leaves them stuck.`,

  'pricing-inquiry': `# Anti-Patterns for Pricing Inquiry

## Anti-Pattern: Just Linking to Pricing Page

❌ **BAD:**
"You can find all our pricing at https://..."

✅ **GOOD:**
"The complete course is $XXX, which includes lifetime access and all future updates. We also have PPP pricing if you're outside the US, and team rates for 5+ people."

**Why it's wrong:** They can find the page themselves. Add value with context.

---

## Anti-Pattern: Not Mentioning Discounts

❌ **BAD:**
"The course is $499."

✅ **GOOD:**
"Full price is $499. We have regional pricing (PPP) available, plus occasional sales. Want me to check if any discounts apply to you?"

**Why it's wrong:** Always surface available discounts proactively.

---

## Anti-Pattern: No Value Justification

❌ **BAD:**
"Yes, that's the price."

✅ **GOOD:**
"At $XXX you get lifetime access, all updates, community Discord, and [specific features]. It's designed to be a one-time investment that pays off quickly."

**Why it's wrong:** Pricing questions often mask value concerns. Address both.`,

  'course-content-locked': `# Anti-Patterns for Locked Content

## Anti-Pattern: Blaming the Customer

❌ **BAD:**
"It looks like you only purchased the basic tier which doesn't include this module."

✅ **GOOD:**
"That module is part of the Pro tier. I can upgrade you for the difference ($XX) if you'd like access. Or happy to answer questions about what's included!"

**Why it's wrong:** Make the path forward easy, not accusatory.

---

## Anti-Pattern: Not Checking First

❌ **BAD:**
"You need to purchase the course to access this content."

✅ **GOOD:**
"Let me check... looks like there was a sync issue with your account. Fixed! Try refreshing and you should have full access now."

**Why it's wrong:** Often it's a bug, not a purchase issue. Check before assuming.

---

## Anti-Pattern: No Clear Upgrade Path

❌ **BAD:**
"That content is for Pro tier only."

✅ **GOOD:**
"That's in the Pro tier! To upgrade: [direct link]. The difference from your current tier is $XX. Includes [benefits]."

**Why it's wrong:** Make buying easy. Don't make them hunt for upgrade options.`,

  'team-license-purchase': `# Anti-Patterns for Team Licenses

## Anti-Pattern: Standard Pricing Only

❌ **BAD:**
"Each license is $499, so 10 licenses would be $4,990."

✅ **GOOD:**
"For 10 seats, we can do $399/seat ($3,990 total) - that's 20% off. Includes centralized admin, usage reporting, and priority support. Want me to set that up?"

**Why it's wrong:** Team purchases always get volume pricing. Lead with the deal.

---

## Anti-Pattern: No Admin Features Mentioned

❌ **BAD:**
"I've set up 10 licenses for your team."

✅ **GOOD:**
"Done! You'll get a team admin dashboard to manage licenses, see progress, and add/remove seats. Here's your admin login: [link]"

**Why it's wrong:** Team buyers need management features. Highlight them.

---

## Anti-Pattern: Slow Enterprise Process

❌ **BAD:**
"For team purchases, please contact our sales team and we'll schedule a call to discuss your needs."

✅ **GOOD:**
"Happy to set this up now! For 10 seats at $399 each: here's an invoice link. Or if you need a formal quote/PO process, I can do that too - just let me know."

**Why it's wrong:** Many "enterprise" buyers just want to buy. Don't add friction.`
}

async function main() {
  console.log('=== Creating Anti-Pattern Docs ===\n')
  
  let created = 0
  
  for (const skill of TOP_SKILLS) {
    console.log(`Processing: ${skill}`)
    
    const refsDir = path.join(SKILLS_DIR, skill, 'references')
    await fs.mkdir(refsDir, { recursive: true })
    
    const antiPatternPath = path.join(refsDir, 'anti-patterns.md')
    const content = ANTI_PATTERNS[skill]
    
    if (content) {
      await fs.writeFile(antiPatternPath, content)
      console.log(`  - Created references/anti-patterns.md`)
      created++
    } else {
      console.log(`  - No anti-patterns defined, skipping`)
    }
  }
  
  console.log(`\n=== Done ===`)
  console.log(`Created ${created} anti-pattern files`)
}

main().catch(console.error)
