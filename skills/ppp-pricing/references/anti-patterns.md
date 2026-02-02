# Anti-Patterns for PPP Pricing

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

**Why it's wrong:** VPNs exist. Don't accuse customers of fraud.