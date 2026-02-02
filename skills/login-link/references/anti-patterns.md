# Anti-Patterns for Login Link

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

**Why it's wrong:** They might have purchased with a different email than they're checking.