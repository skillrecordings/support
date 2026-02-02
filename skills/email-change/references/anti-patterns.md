# Anti-Patterns for Email Change

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

**Why it's wrong:** We can look this up. Don't make customers do work we can do ourselves.