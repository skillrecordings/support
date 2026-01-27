# SDK Tooling Gaps Analysis

> Research: What SDK methods would make the support agent smarter?
> Date: 2025-07-27
> Status: **Draft — Ready for Review**

---

## 1. Current SDK Surface

The `SupportIntegration` interface (`packages/sdk/src/integration.ts`) exposes 12 methods. The `IntegrationClient` (`packages/sdk/src/client.ts`) mirrors all of them as HMAC-signed POST requests via the handler (`packages/sdk/src/handler.ts`).

| # | Method | Required | Description | Used by Agent? |
|---|--------|----------|-------------|----------------|
| 1 | `lookupUser(email)` | ✅ Required | Find user by email → `User \| null` | ✅ **Yes** — gather-context, agent tool, escalation |
| 2 | `getPurchases(userId)` | ✅ Required | Fetch all purchases → `Purchase[]` | ✅ **Yes** — gather-context, agent tool, escalation |
| 3 | `getSubscriptions(userId)` | Optional | Fetch subscriptions → `Subscription[]` | ⚠️ **Partial** — Client has method, agent has Stripe tool instead |
| 4 | `revokeAccess(params)` | ✅ Required | Revoke access after refund → `ActionResult` | ✅ **Yes** — process-refund tool |
| 5 | `transferPurchase(params)` | ✅ Required | Transfer purchase ownership → `ActionResult` | ✅ **Yes** — agent transferPurchase tool |
| 6 | `generateMagicLink(params)` | ✅ Required | Create passwordless login URL → `{ url }` | ✅ **Yes** — escalation workflow (for context comments) |
| 7 | `updateEmail(params)` | Optional | Change user email → `ActionResult` | ❌ **No** — in SDK, not wired to any agent tool |
| 8 | `updateName(params)` | Optional | Change user name → `ActionResult` | ❌ **No** — in SDK, not wired to any agent tool |
| 9 | `getClaimedSeats(bulkCouponId)` | Optional | Team seat info → `ClaimedSeat[]` | ❌ **No** — in SDK, not wired to any agent tool |
| 10 | `searchContent(request)` | Optional | Search product content → `ContentSearchResponse` | ✅ **Yes** — agent searchProductContent tool (with caching) |
| 11 | `getProductStatus(productId)` | Optional | Product availability → `ProductStatus \| null` | ✅ **Yes** — agent check_product_availability tool |

### App Capabilities (from seed data — Total TypeScript)

```
lookup_user, get_purchases, revoke_access, transfer_purchase,
generate_magic_link, update_email, update_name, get_claimed_seats
```

**Notable:** `searchContent` and `getProductStatus` are NOT in the capabilities list, suggesting they haven't been implemented on the app side yet.

---

## 2. Agent Usage Audit

### What the agent actively calls

| SDK Method | Where Called | Context |
|-----------|-------------|---------|
| `lookupUser` | `gather-context.ts` → `createGatherTools` | First thing in every conversation — find the customer |
| `getPurchases` | `gather-context.ts` → `createGatherTools` | Immediately after lookupUser — get purchase history |
| `generateMagicLink` | `handle-escalation.ts` | During escalation to include login link in comment |
| `revokeAccess` | `process-refund.ts` tool | Called via agent tool when refund is approved |
| `transferPurchase` | `agent/config.ts` → agentTools | Agent tool (deferred to HITL approval flow) |
| `searchContent` | `agent/config.ts` → searchProductContent | Agent searches for relevant content to recommend |
| `getProductStatus` | `agent/config.ts` → check_product_availability | Agent checks seat availability before making claims |

### SDK methods that exist but are NEVER called

| Method | Why Not Used | Impact |
|--------|-------------|--------|
| `getSubscriptions` | Agent uses direct Stripe Connect queries instead (`getSubscriptionStatus` tool) | Low — Stripe tools work. But SDK method would be cleaner and avoid Stripe API key requirements |
| `updateEmail` | No agent tool wraps it | **Medium** — Agent can't help with email change requests (classified as `support_transfer`) |
| `updateName` | No agent tool wraps it | Low — Rarely requested |
| `getClaimedSeats` | No agent tool wraps it | **Medium** — Agent can't help team license customers see who has claimed seats |

### What the agent has but SDK doesn't provide

The agent has several Stripe-direct tools that bypass the SDK entirely:

| Agent Tool | SDK Equivalent | Notes |
|-----------|---------------|-------|
| `getPaymentHistory` | None | Queries Stripe Connect directly |
| `lookupCharge` | None | Queries Stripe Connect directly |
| `getSubscriptionStatus` | `getSubscriptions` (unused) | Duplicates SDK capability |
| `verifyRefund` | None | Queries Stripe Connect directly |

This creates a **dual data path** problem: some data comes via SDK (app-owned), some via Stripe Connect (platform-owned). The app's database may disagree with Stripe's data.

### What the agent wishes it had

Evidence from code analysis:

1. **Draft prompts reference data that doesn't exist**: The `support_billing` prompt says "Point them to the invoices page" — hardcoded URL. No SDK method to get the actual invoices URL per app.

2. **Refund policy is hardcoded**: `support_refund` prompt says "within 30 days: process it" — the 30-day window is in `auto_approve_refund_days` in the DB, but the agent prompt doesn't have access to app-specific policy.

3. **Knowledge base search is NOT IMPLEMENTED**: `searchKnowledge` tool in `packages/core/src/tools/search-knowledge.ts` throws `'searchKnowledge: Upstash Vector integration not yet implemented'`. The agent relies on `buildAgentContext` for retrieval instead.

4. **The agent can't look up coupons/discounts**: `presales_faq` questions about pricing, discounts, and PPP are classified but the agent has zero tools to answer them. The classify prompt mentions PPP, student discounts, regional pricing — none of which the agent can look up.

5. **No recent activity data**: When debugging access issues, the agent can't check "when did the user last log in?" or "has the user completed any content?"

6. **No known issues / status page**: Agent has no way to check if there's a current outage or known bug affecting the product.

---

## 3. Identified Gaps

### P0 — Agent Is Broken Without These

#### 3.1 `getActivePromotions()` / `getCouponInfo(code: string)`

```typescript
// On SupportIntegration:
getActivePromotions?(): Promise<Promotion[]>
getCouponInfo?(code: string): Promise<CouponInfo | null>

interface Promotion {
  id: string
  name: string
  code?: string         // Coupon code if applicable
  discountType: 'percent' | 'fixed'
  discountAmount: number // Percentage or cents
  validFrom?: string    // ISO date
  validUntil?: string   // ISO date
  active: boolean
  conditions?: string   // Human-readable conditions (PPP, student, etc.)
}

interface CouponInfo {
  code: string
  valid: boolean
  discountType: 'percent' | 'fixed'
  discountAmount: number
  restrictionType?: 'ppp' | 'student' | 'bulk' | 'general'
  usageCount: number
  maxUses?: number
  expiresAt?: string
}
```

**Why the agent needs it:**
- `presales_faq` is a classified category specifically for pricing/discount questions
- The classify prompt explicitly lists PPP, student discounts, regional pricing, coupon codes
- When customers ask "Do you have a discount?", the agent has NO DATA to answer
- Currently must escalate every pricing question → defeats the purpose of `presales_faq` category

**Priority: P0** — The presales_faq routing path is broken without this. The agent classifies these correctly but can't answer them.

---

#### 3.2 `getRefundPolicy()`

```typescript
getRefundPolicy?(): Promise<RefundPolicy>

interface RefundPolicy {
  autoApproveWindowDays: number   // e.g., 30
  manualApproveWindowDays: number // e.g., 45
  noRefundAfterDays?: number      // e.g., 60
  specialConditions?: string[]    // e.g., ["Lifetime access: 60 day window"]
  policyUrl?: string              // Link to full policy page
}
```

**Why the agent needs it:**
- Refund window is hardcoded in the draft prompt as "30 days" and "30-45 days"
- Different products may have different refund policies
- The DB field `auto_approve_refund_days` exists per app but isn't accessible to the agent
- Agent currently lies if the app has a different window

**Priority: P0** — Agent gives wrong refund policy info for apps with non-default windows.

---

### P1 — Significantly Better With These

#### 3.3 `getContentAccess(userId: string)`

```typescript
getContentAccess?(userId: string): Promise<ContentAccess>

interface ContentAccess {
  userId: string
  products: Array<{
    productId: string
    productName: string
    accessLevel: 'full' | 'partial' | 'preview' | 'expired'
    modules?: Array<{
      id: string
      title: string
      accessible: boolean
    }>
    expiresAt?: string // null = lifetime
  }>
  teamMembership?: {
    teamId: string
    teamName: string
    role: 'member' | 'admin' | 'owner'
    seatClaimedAt: string
  }
}
```

**Why the agent needs it:**
- `support_access` is a high-volume category (login/access issues)
- Currently the agent knows the user has a **purchase** but not what **content** they can actually access
- A purchase doesn't always mean access (e.g., expired subscription, revoked seat, upgrade vs individual module purchase)
- Agent can't tell a user "You have access to modules 1-5 but not the advanced section"
- Team members may have different access than direct purchasers

**Priority: P1** — Agent can partially help access issues with purchase data alone, but can't give precise answers.

---

#### 3.4 `getRecentActivity(userId: string)`

```typescript
getRecentActivity?(userId: string): Promise<UserActivity>

interface UserActivity {
  userId: string
  lastLoginAt?: string      // ISO date of last login
  lastActiveAt?: string     // Last meaningful activity
  lessonsCompleted: number
  totalLessons: number
  completionPercent: number
  recentItems: Array<{
    type: 'lesson_completed' | 'exercise_submitted' | 'login' | 'download'
    title: string
    timestamp: string
  }>
  deviceInfo?: {
    browser?: string
    os?: string
    lastIp?: string // For debugging access issues
  }
}
```

**Why the agent needs it:**
- Access issues (`support_access`): "I can't log in" — agent can check "You last logged in 3 days ago from Chrome, so your account is active"
- Technical issues (`support_technical`): "Where should I start?" — agent can see "You've completed 40% of the course, the next module is X"
- Refund triage: "Have you used the product?" — agent can see completion data to assess if product was actually used

**Priority: P1** — Transforms access debugging from guesswork to data-driven.

---

#### 3.5 `getLicenseInfo(purchaseId: string)`

```typescript
getLicenseInfo?(purchaseId: string): Promise<LicenseInfo | null>

interface LicenseInfo {
  purchaseId: string
  licenseType: 'individual' | 'team' | 'enterprise' | 'site'
  totalSeats: number
  claimedSeats: number
  availableSeats: number
  expiresAt?: string
  claimedBy: Array<{
    email: string
    claimedAt: string
    lastActiveAt?: string
  }>
  bulkCouponId?: string  // For linking to existing getClaimedSeats
  adminEmail?: string
}
```

**Why the agent needs it:**
- `presales_team` is an explicit classification category for team/enterprise inquiries
- `getClaimedSeats` exists but requires a `bulkCouponId` — the agent doesn't know the coupon ID from a purchase
- Team customers ask "How many seats do I have left?" and the agent can't answer
- Combines purchase-level license data with seat data in one call

**Priority: P1** — Team support requires this. Currently all team questions are escalated.

---

#### 3.6 Wire `updateEmail` and `updateName` to Agent Tools

These already exist in the SDK but have no agent tool wrappers.

```typescript
// In agent/config.ts — new tools:
updateEmail: tool({
  description: 'Update a customer email address on their account',
  inputSchema: z.object({
    userId: z.string(),
    appId: z.string(),
    newEmail: z.string().email(),
  }),
  execute: async ({ userId, appId, newEmail }) => {
    const app = await getApp(appId)
    const client = new IntegrationClient({ ... })
    return client.updateEmail({ userId, newEmail })
  },
})
```

**Why the agent needs it:**
- `support_transfer` category includes email change requests
- Agent currently can't change email — must escalate all transfer/email requests
- These are trivial operations that should be auto-approved

**Priority: P1** — Reduces escalation volume for simple account changes.

---

### P2 — Nice to Have

#### 3.7 `getKnownIssues()`

```typescript
getKnownIssues?(): Promise<KnownIssue[]>

interface KnownIssue {
  id: string
  title: string
  description: string
  severity: 'critical' | 'major' | 'minor'
  affectedProducts?: string[]
  reportedAt: string
  resolvedAt?: string
  workaround?: string
  statusPageUrl?: string
}
```

**Why the agent needs it:**
- When multiple customers report the same issue, the agent doesn't know it's a known bug
- Agent wastes time troubleshooting issues that have known workarounds
- Could reduce escalations by 20%+ during outages
- Agent can proactively say "We're aware of X issue and working on a fix"

**Priority: P2** — Valuable during incidents, but incidents are infrequent. Requires an issue tracking integration on the app side.

---

#### 3.8 `getInvoice(purchaseId: string)` / `getInvoiceUrl(purchaseId: string)`

```typescript
getInvoiceUrl?(purchaseId: string): Promise<{ url: string } | null>
```

**Why the agent needs it:**
- `support_billing` prompt currently hardcodes `https://www.totaltypescript.com/invoices`
- Each app would have a different invoices URL
- Agent could link directly to the specific invoice instead of a generic page

**Priority: P2** — The current hardcoded URL approach works for Total TypeScript but breaks for other apps.

---

#### 3.9 `getAppInfo()`

```typescript
getAppInfo?(): Promise<AppInfo>

interface AppInfo {
  name: string
  instructorName: string
  supportEmail: string
  websiteUrl: string
  invoicesUrl?: string
  discordUrl?: string
  refundPolicyUrl?: string
  privacyPolicyUrl?: string
  termsUrl?: string
}
```

**Why the agent needs it:**
- Agent prompt says "NEVER mention Skill Recordings, only use product name"
- But the agent has to know the product name, instructor name, and relevant URLs
- Currently these are partially available from the DB `App` record but not all fields exist
- Would eliminate all hardcoded URLs in prompts

**Priority: P2** — Enables proper multi-app support. Currently manageable with DB fields.

---

#### 3.10 `searchContent()` — Already in SDK, needs app implementation

The SDK already defines `searchContent` and the agent already has a tool for it. But:
- The Total TypeScript app capabilities list doesn't include it
- The tool eval tests mock it but it may not be deployed
- The agent's "NEVER FABRICATE PRODUCT CONTENT" guardrail exists because this isn't working yet

**Priority: P1 (implementation, not SDK change)** — The contract exists; apps need to implement it.

---

## 4. Implementation Notes

### Which apps need to implement each method

Currently only **Total TypeScript** is registered. All new SDK methods must be implemented there first.

| Method | TT Complexity | Notes |
|--------|--------------|-------|
| `getActivePromotions` | Medium | Query Stripe for active coupons + product-specific promo config |
| `getCouponInfo` | Low | Simple Stripe coupon lookup |
| `getRefundPolicy` | Low | Return static config (could be JSON file) |
| `getContentAccess` | Medium | Query purchase + module access mapping |
| `getRecentActivity` | Medium-High | Requires activity logging (may not exist yet) |
| `getLicenseInfo` | Medium | Combine purchase + bulk coupon + seat data |
| Wire `updateEmail` tool | Low | SDK method exists, just need agent tool wrapper |
| Wire `updateName` tool | Low | SDK method exists, just need agent tool wrapper |
| `getKnownIssues` | High | Requires issue tracking system or manual JSON |
| `getInvoiceUrl` | Low | Construct URL from purchase ID |
| `getAppInfo` | Low | Return static config |

### SDK changes required

1. **New types** in `packages/sdk/src/types.ts`: `Promotion`, `CouponInfo`, `RefundPolicy`, `ContentAccess`, `UserActivity`, `LicenseInfo`, `KnownIssue`, `AppInfo`
2. **New optional methods** in `packages/sdk/src/integration.ts`: 8 new methods on `SupportIntegration`
3. **Client methods** in `packages/sdk/src/client.ts`: Mirror each new method
4. **Handler routes** in `packages/sdk/src/handler.ts`: Add `case` branches for each action
5. **New agent tools** in `packages/core/src/agent/config.ts`: Wrap each method as an AI SDK tool
6. **Gather step updates** in `packages/core/src/pipeline/steps/gather.ts`: Pull new data during context gathering
7. **Draft prompt updates** in `packages/core/src/pipeline/steps/draft.ts`: Reference new data in prompts

### Architecture principle: SDK vs Stripe Connect

Current architecture has a **split brain** problem:
- SDK provides app-specific data (user, purchases, access management)
- Stripe Connect provides payment data (charges, subscriptions, refunds)

For **new methods**, prefer SDK over Stripe Connect because:
1. Apps can include business logic (e.g., "this coupon is only for PPP users")
2. Apps own their data model (purchase ≠ Stripe charge)
3. Reduces Stripe API key exposure
4. Apps can cache/optimize responses

Exception: Stripe verification tools (`verifyRefund`, `lookupCharge`) should stay as direct Stripe Connect queries since they're cross-cutting platform concerns.

---

## 5. Proposed Epic

### Epic: SDK Tooling Gaps — Phase 1

**Goal:** Give the agent data to answer presales and team questions, and fix the hardcoded refund policy.

#### Subtask 1: SDK Types & Interface (P0+P1 methods)
**Files:** `packages/sdk/src/types.ts`, `packages/sdk/src/integration.ts`
- Add new type definitions: `Promotion`, `CouponInfo`, `RefundPolicy`, `ContentAccess`, `UserActivity`, `LicenseInfo`
- Add optional methods to `SupportIntegration`: `getActivePromotions`, `getCouponInfo`, `getRefundPolicy`, `getContentAccess`, `getRecentActivity`, `getLicenseInfo`
- **Estimate:** Small — type definitions only

#### Subtask 2: SDK Client & Handler (wire new methods)
**Files:** `packages/sdk/src/client.ts`, `packages/sdk/src/handler.ts`
- Add client methods for each new integration method
- Add handler `case` branches with 501 fallback for optional methods
- Add Zod schemas for response validation
- **Estimate:** Small — mechanical, follows existing pattern

#### Subtask 3: Wire updateEmail and updateName Agent Tools
**Files:** `packages/core/src/agent/config.ts`
- Add `updateEmail` and `updateName` tools using existing SDK methods
- Add HITL approval gate (same as transferPurchase)
- **Estimate:** Small — pattern already exists for other tools

#### Subtask 4: New Agent Tools (P0 methods)
**Files:** `packages/core/src/agent/config.ts`, new files in `packages/core/src/tools/`
- `getCouponInfo` tool — look up coupon/discount codes
- `getActivePromotions` tool — check current sales/discounts
- `getRefundPolicy` tool — fetch app-specific refund policy
- Update draft prompts to use dynamic policy data instead of hardcoded values
- **Estimate:** Medium — new tools + prompt updates

#### Subtask 5: New Agent Tools (P1 methods)
**Files:** `packages/core/src/agent/config.ts`, new files in `packages/core/src/tools/`
- `getContentAccess` tool — check what content a user can access
- `getRecentActivity` tool — check user's recent activity
- `getLicenseInfo` tool — check team license details
- **Estimate:** Medium

#### Subtask 6: Gather Step Enhancement
**Files:** `packages/core/src/pipeline/steps/gather.ts`, `packages/core/src/inngest/workflows/gather-context.ts`
- Add new SDK calls to `GatherTools` interface
- Pull refund policy, content access, and license info during gather (when relevant to category)
- Category-aware gathering: only fetch data relevant to the classification
  - `support_refund` → fetch refund policy
  - `support_access` → fetch content access + recent activity
  - `presales_faq` → fetch promotions
  - `presales_team` → fetch license info
- **Estimate:** Medium

#### Subtask 7: Draft Prompt Updates
**Files:** `packages/core/src/pipeline/steps/draft.ts`
- Remove hardcoded URLs and policy numbers
- Add dynamic prompt sections that reference gathered data
- Update `formatContextForPrompt` to include new data types
- **Estimate:** Small-Medium

#### Subtask 8: Total TypeScript App Implementation
**Files:** (in the TT app codebase, not this repo)
- Implement each new SDK method on the app side
- Start with P0 methods: promotions, coupons, refund policy
- Then P1: content access, recent activity, license info
- **Estimate:** Large — requires knowledge of TT data model

---

## Appendix: Classification Categories vs Required Data

| Category | Data the Agent Needs | Current Availability |
|----------|---------------------|---------------------|
| `support_access` | User, purchases, **content access**, **recent activity**, magic link | Partial — no access/activity |
| `support_refund` | User, purchases, payment history, **refund policy** | Partial — hardcoded policy |
| `support_transfer` | User, purchases, **updateEmail** tool | Partial — no email update tool |
| `support_technical` | User, purchases, **content search**, knowledge base | Partial — KB not implemented |
| `support_billing` | User, purchases, **invoice URL**, payment history | Partial — hardcoded URL |
| `presales_faq` | **Promotions**, **coupons**, **product info**, content search | ❌ None available |
| `presales_team` | **License info**, **team seats**, pricing | ❌ None available |
| `presales_consult` | Product info, content search (escalated to instructor) | ❌ Escalated |
| `fan_mail` | N/A (routed to instructor) | ✅ OK |
| `spam` / `system` | N/A (silenced) | ✅ OK |

---

## 6. App Integration Audit

> Audit date: 2025-07-27
> Audited files:
> - AI Hero: `apps/ai-hero/src/app/api/support/integration.ts`
> - Total TypeScript: `apps/total-typescript/src/lib/support-integration.ts`

### 6.1 AI Hero (CourseBuilder)

**Integration file:** `~/Code/badass-courses/course-builder/apps/ai-hero/src/app/api/support/integration.ts`
**API route:** Next.js App Router — `apps/ai-hero/src/app/api/support/[...action]/route.ts`
**DB ORM:** Drizzle via `courseBuilderAdapter`
**SDK version consumed:** `@skillrecordings/sdk@^0.4.0`

#### Methods Currently Implemented

| SDK Method | Implemented | Notes |
|-----------|-------------|-------|
| `lookupUser` | ✅ | Via `courseBuilderAdapter.getUserByEmail()` — no `createdAt` from adapter (defaults to `new Date()`) |
| `getPurchases` | ✅ | Via `courseBuilderAdapter.getPurchasesForUser()` — converts `totalAmount` Decimal → cents via `Math.round(Number(p.totalAmount) * 100)` |
| `getSubscriptions` | ❌ | Not implemented (CourseBuilder has Subscription table but not wired) |
| `revokeAccess` | ✅ | Uses `courseBuilderAdapter.updatePurchaseStatusForCharge()` — requires `merchantChargeId` |
| `transferPurchase` | ✅ | Via `courseBuilderAdapter.findOrCreateUser()` + `courseBuilderAdapter.transferPurchaseToUser()` |
| `generateMagicLink` | ✅ | Via `courseBuilderAdapter.createVerificationToken()` — constructs NextAuth email callback URL |
| `updateEmail` | ✅ | Via `courseBuilderAdapter.updateUser()` — checks email uniqueness first |
| `updateName` | ✅ | Via `courseBuilderAdapter.updateUser()` |
| `getClaimedSeats` | ❌ | Not implemented — CourseBuilder uses Organization model for teams, not bulkCouponId |
| `searchContent` | ✅ | Uses **Typesense** — queries `title,description,summary,tags` for published content |
| `getProductStatus` | ✅ | Queries product + counts active purchases. Supports enrollment windows (`openEnrollment`/`closeEnrollment` from product fields) |

**Capabilities NOT registered** (since AI Hero isn't seeded in support DB yet):
- No entry in `SUPPORT_apps` table — needs to be added with correct capabilities list

#### Data Models Available for New Methods

**Coupon/Promotion Data (for `getActivePromotions`, `getCouponInfo`):**
- `Coupon` table: `id`, `code`, `createdAt`, `expires`, `maxUses`, `usedCount`, `percentageDiscount`, `amountDiscount`, `restrictedToProductId`, `merchantCouponId`, `fields` (JSON)
- `MerchantCoupon` table: `identifier` (Stripe coupon ID), `percentageDiscount`, `amountDiscount`, `type`, `organizationId`
- **Key difference from TT:** CourseBuilder coupons have both `percentageDiscount` AND `amountDiscount` fields (TT only has percentage)
- **Key difference from TT:** CourseBuilder coupons have a `fields` JSON column — could store PPP/student/regional metadata
- ✅ **Sufficient data model** for both methods

**Refund Policy (for `getRefundPolicy`):**
- Support platform `SUPPORT_apps` table has `auto_approve_refund_days` (default: 30) and `auto_approve_transfer_days` (default: 14)
- No per-product refund policy in CourseBuilder schema
- ✅ **Can return** static config from app-side env or config file, supplemented by support DB

**Content Access (for `getContentAccess`):**
- `Purchase` table → `productId`, `status` (Valid/Refunded/Transferred)
- `ContentResourceProduct` table: maps products → content resources
- `Entitlement` table: `entitlementType`, `userId`, `organizationId`, `sourceType` (PURCHASE/SUBSCRIPTION/MANUAL), `sourceId`, `expiresAt`, `metadata` (JSON)
- `EntitlementType` table: defines types of access grants
- `Organization` + `OrganizationMembership` tables: team-based access
- ✅ **Rich data model** — entitlements provide granular access tracking beyond just "has purchase"

**Activity Tracking (for `getRecentActivity`):**
- `ResourceProgress` table: `userId`, `resourceId`, `completedAt`, `updatedAt`, `createdAt`, `fields` (JSON)
- `Session` table: contains login sessions (limited data — no IP/device info)
- No explicit "last login" timestamp on User
- ⚠️ **Partial** — has completion progress but limited login/device tracking

**Team/License Data (for `getLicenseInfo`):**
- `Organization` table: team entities with `name`, `fields` (JSON)
- `OrganizationMembership` table: `userId`, `role` (user/admin/etc), `invitedById`, `organizationId`
- `Purchase` table: `organizationId`, `organizationMembershipId` — purchases can be org-scoped
- `Subscription` table: `organizationId`, `productId`, `status`, `merchantSubscriptionId`
- **No `bulkCouponId` pattern** — CourseBuilder uses Organizations for teams, NOT bulk coupons
- ⚠️ **Different model** from TT — will need Organization-based implementation instead of `getClaimedSeats` pattern

#### AI Hero Quirks & Limitations

1. **Organization-based teams** — CourseBuilder uses `Organization` → `OrganizationMembership` instead of TT's `bulkCouponId` → `redeemedBulkCouponId` pattern. The `getLicenseInfo` SDK method will need to support both patterns (org-based and coupon-based)
2. **Entitlements system** — CourseBuilder has a proper entitlements layer (`Entitlement` + `EntitlementType`) that TT lacks. This means `getContentAccess` can be much richer for AI Hero
3. **Adapter abstraction** — AI Hero uses `courseBuilderAdapter` for all DB ops, which adds a layer of indirection. New methods should use the adapter where possible for consistency
4. **Typesense for search** — Content search is already implemented and working via Typesense (unlike TT which uses Sanity GROQ)
5. **No `createdAt` on user** — The adapter doesn't return `createdAt`, so lookupUser defaults to `new Date()`. Minor bug but worth noting

---

### 6.2 Total TypeScript

**Integration file:** `~/Code/skillrecordings/products/apps/total-typescript/src/lib/support-integration.ts`
**API route:** Next.js Pages Router — `apps/total-typescript/src/pages/api/support/index.ts`
**DB ORM:** Prisma via `@skillrecordings/database`
**SDK version consumed:** `@skillrecordings/sdk@^0.4.0`
**Tests:** `src/lib/__tests__/support-integration.test.ts` (Jest, mocked Prisma)

#### Methods Currently Implemented

| SDK Method | Implemented | Notes |
|-----------|-------------|-------|
| `lookupUser` | ✅ | Via `prisma.user.findUnique()` — same `createdAt: new Date()` bug as AI Hero |
| `getPurchases` | ✅ | Via `prisma.purchase.findMany()` with product + merchantCharge includes |
| `getSubscriptions` | ❌ | Not implemented (no Subscription model in TT's Prisma schema) |
| `revokeAccess` | ✅ | Direct `prisma.purchase.update()` to status='Refunded' — simpler than AI Hero |
| `transferPurchase` | ✅ | Find/create user, verify ownership, create `PurchaseUserTransfer` record, update purchase |
| `generateMagicLink` | ✅ | Via `@skillrecordings/skill-api` `createVerificationUrl()` |
| `updateEmail` | ✅ | Via `prisma.user.update()` — checks email uniqueness |
| `updateName` | ✅ | Via `prisma.user.update()` |
| `getClaimedSeats` | ✅ | Queries `prisma.purchase.findMany()` where `redeemedBulkCouponId` matches |
| `searchContent` | ✅ | Uses **Sanity GROQ** — queries modules, exercises, articles, tips with text scoring |
| `getProductStatus` | ✅ | Queries product by ID or `key` slug, counts active purchases, maps status Int to state |

**Registered capabilities** (from seed data):
```
lookup_user, get_purchases, revoke_access, transfer_purchase,
generate_magic_link, update_email, update_name, get_claimed_seats
```
**Missing from capabilities:** `search_content`, `get_product_status` (implemented but not declared!)

#### Data Models Available for New Methods

**Coupon/Promotion Data (for `getActivePromotions`, `getCouponInfo`):**
- `Coupon` model: `id`, `code` (unique), `createdAt`, `expires`, `maxUses`, `usedCount`, `percentageDiscount` (Decimal 3,2), `restrictedToProductId`, `bulkPurchaseId`, `merchantCouponId`, `status`, `default`
- `MerchantCoupon` model: `identifier` (Stripe coupon ID), `percentageDiscount`, `type`
- **No `amountDiscount`** — TT coupons only support percentage discounts
- **No `fields` JSON** — no metadata for PPP/student/regional classification (would need to infer from `MerchantCoupon.type`)
- ✅ **Sufficient** for basic promotion/coupon info

**Refund Policy (for `getRefundPolicy`):**
- Support platform: `auto_approve_refund_days=30`, `auto_approve_transfer_days=14`
- No per-product policy in TT schema
- ✅ **Same as AI Hero** — return from app config

**Content Access (for `getContentAccess`):**
- `Purchase` model: `productId`, `status`, `userId`
- `Product` model: `name`, `productType`, `key`, `status`, `quantityAvailable`
- `UpgradableProducts` model: tracks upgrade paths between products
- No entitlements layer — access is purely purchase-based
- ⚠️ **Simpler model** — content access = "has a valid purchase for product"

**Activity Tracking (for `getRecentActivity`):**
- `LessonProgress` model: `userId`, `lessonId`, `moduleId`, `sectionId`, `lessonSlug`, `completedAt`, `createdAt`
- `Session` model: `sessionToken`, `userId`, `expires` — login sessions
- No device/browser/IP tracking
- ⚠️ **Partial** — has lesson completion data but limited login tracking

**Team/License Data (for `getLicenseInfo`):**
- `Coupon` model with `bulkPurchaseId` — the bulk coupon is linked to a purchase
- `Purchase` model with `bulkCouponId` and `redeemedBulkCouponId` — tracks seat redemptions
- `getClaimedSeats` already works via `redeemedBulkCouponId` lookup
- `PurchaseUserTransfer` model — tracks transfer history
- ✅ **Good model** — the bulkCoupon pattern is well established

#### TT Quirks & Limitations

1. **Coupon-based teams** — TT uses `bulkCouponId` → `redeemedBulkCouponId` for team seats, NOT organizations. This is the simpler, older pattern
2. **No entitlements** — Access is purely "do you have a Valid purchase?" No granular entitlement types
3. **Prisma (not Drizzle)** — TT uses Prisma while AI Hero uses Drizzle. Different query patterns
4. **Sanity for content** — Content lives in Sanity CMS, queried via GROQ. Different from AI Hero's Typesense
5. **Pages Router** — API route uses Next.js Pages Router with manual body parsing for HMAC verification. AI Hero uses App Router
6. **No subscription model** — TT's Prisma schema has no `Subscription` table (products are one-time purchase)
7. **Product status is an Int** — Mapped: 0=draft, 1=active, 2=unavailable, 3=archived. AI Hero uses string states

---

### 6.3 Comparative Summary

| Capability | AI Hero (CourseBuilder) | Total TypeScript |
|-----------|------------------------|------------------|
| **DB ORM** | Drizzle + courseBuilderAdapter | Prisma |
| **Content Search** | Typesense | Sanity GROQ |
| **Team Model** | Organization + Membership | BulkCoupon + RedeemedBulkCoupon |
| **Entitlements** | ✅ Full entitlement system | ❌ Purchase-based only |
| **Activity Tracking** | ResourceProgress | LessonProgress |
| **Coupon `amountDiscount`** | ✅ Supports fixed amount | ❌ Percentage only |
| **Coupon metadata** | ✅ `fields` JSON column | ❌ Infer from MerchantCoupon.type |
| **Subscriptions** | ✅ Subscription table exists | ❌ No subscriptions |
| **API Router** | App Router (native Request/Response) | Pages Router (NextApiRequest adapter) |

---

## 7. Changeset & Versioning Plan

### Current State

- **SDK package:** `@skillrecordings/sdk` at version `0.4.0`
- **Published to:** npm (public, `"access": "public"` in changeset config)
- **Consumed by:** Both TT (`^0.4.0`) and AI Hero (`^0.4.0`) via npm
- **Build tool:** tsup (ESM only, with dts and sourcemaps)
- **Changeset CLI:** `@changesets/cli@^2.29.8` configured at monorepo root
- **Release workflow:** `.github/workflows/publish.yml` — on push to main, runs changesets/action with bun

### Release Flow

```
1. Create changeset          → npx changeset (interactive)
2. PR merges to main         → GitHub Action triggers
3. changesets/action runs     → Creates "release PR" with version bumps
4. Release PR merges          → changesets/action publishes to npm
5. Apps update dependency     → npm update @skillrecordings/sdk
```

### Version Bump Strategy

Since all new SDK methods are **optional** (existing integrations won't break), this is a **minor** version bump:

```
@skillrecordings/sdk: 0.4.0 → 0.5.0
```

Changeset content:
```markdown
---
"@skillrecordings/sdk": minor
---

Add SDK methods for promotions, coupons, refund policy, content access, 
activity tracking, license info, and app info. All methods are optional 
on SupportIntegration — existing implementations continue to work.
```

### SDK → App Update Sequence

```
Phase 1: SDK Core (this repo)
  ├─ 1a. Add types to packages/sdk/src/types.ts
  ├─ 1b. Add methods to packages/sdk/src/integration.ts
  ├─ 1c. Add client methods to packages/sdk/src/client.ts
  ├─ 1d. Add handler routes to packages/sdk/src/handler.ts
  └─ 1e. Create changeset, merge → publish v0.5.0 to npm

Phase 2: Agent Core (this repo, can parallel with Phase 1c-1e)
  ├─ 2a. Wire updateEmail/updateName agent tools
  ├─ 2b. Create new P0 agent tools (coupon, promotion, refund policy)
  ├─ 2c. Create new P1 agent tools (content access, activity, license)
  ├─ 2d. Update gather step with category-aware fetching
  └─ 2e. Update draft prompts to use dynamic data

Phase 3: App Implementations (external repos, after v0.5.0 published)
  ├─ 3a. AI Hero: npm update @skillrecordings/sdk, implement new methods
  ├─ 3b. Total TypeScript: npm update @skillrecordings/sdk, implement new methods
  ├─ 3c. Update capabilities arrays in both apps
  └─ 3d. Update SUPPORT_apps seed/config with new capabilities

Phase 4: Integration Testing
  ├─ 4a. Test each new method via support platform eval suite
  ├─ 4b. Verify 501 fallback for unimplemented optional methods
  └─ 4c. End-to-end: classify → gather → draft with new data
```

---

## 8. Expanded Epic — Full Subtask Plan

### Epic: SDK Tooling Gaps — Agent Intelligence Phase 1

**Cell ID:** `cell--al4e8-mkx1h02ozta`

Below is the full subtask breakdown including app-specific implementation work.

---

#### Subtask 1: SDK Types & Interface (P0+P1 methods) ✅ *already in hive*
**Cell:** `cell--al4e8-mkx1hnd5k3h`
**Files:** `packages/sdk/src/types.ts`, `packages/sdk/src/integration.ts`
**Estimate:** Small (types only)

New types: `Promotion`, `CouponInfo`, `RefundPolicy`, `ContentAccess`, `UserActivity`, `LicenseInfo`, `AppInfo`
New optional methods on `SupportIntegration`: `getActivePromotions`, `getCouponInfo`, `getRefundPolicy`, `getContentAccess`, `getRecentActivity`, `getLicenseInfo`, `getAppInfo`

---

#### Subtask 2: SDK Client & Handler (wire new methods) ✅ *already in hive*
**Cell:** `cell--al4e8-mkx1hogt6y2`
**Files:** `packages/sdk/src/client.ts`, `packages/sdk/src/handler.ts`
**Depends on:** Subtask 1
**Estimate:** Small (mechanical, follows existing pattern)

---

#### Subtask 3: Changeset & SDK Publish 🆕
**Files:** `.changeset/`, `packages/sdk/package.json`
**Depends on:** Subtasks 1 + 2
**Estimate:** Tiny

Create changeset for `@skillrecordings/sdk` minor bump (0.4.0 → 0.5.0). Merge to main triggers publish workflow. This must complete before app implementations can begin.

---

#### Subtask 4: Wire updateEmail/updateName tools ✅ *already in hive*
**Cell:** `cell--al4e8-mkx1hpk1qvz`
**Files:** `packages/core/src/agent/config.ts`
**Estimate:** Small

---

#### Subtask 5: New Agent Tools — P0 ✅ *already in hive*
**Cell:** `cell--al4e8-mkx1i576syi`
**Files:** `packages/core/src/agent/config.ts`, `packages/core/src/tools/`
**Depends on:** Subtask 2
**Estimate:** Medium

---

#### Subtask 6: New Agent Tools — P1 ✅ *already in hive*
**Cell:** `cell--al4e8-mkx1i68csxw`
**Files:** `packages/core/src/agent/config.ts`, `packages/core/src/tools/`
**Depends on:** Subtask 2
**Estimate:** Medium

---

#### Subtask 7: Gather Step Enhancement ✅ *already in hive*
**Cell:** `cell--al4e8-mkx1i78pe0i`
**Files:** `packages/core/src/pipeline/steps/gather.ts`, `packages/core/src/inngest/workflows/gather-context.ts`
**Depends on:** Subtasks 5 + 6
**Estimate:** Medium

---

#### Subtask 8: Draft Prompt Updates ✅ *already in hive*
**Cell:** `cell--al4e8-mkx1i8c256v`
**Files:** `packages/core/src/pipeline/steps/draft.ts`
**Depends on:** Subtask 7
**Estimate:** Small-Medium

---

#### Subtask 9: AI Hero — Implement New SDK Methods 🆕
**Repo:** `badass-courses/course-builder`
**Files:** `apps/ai-hero/src/app/api/support/integration.ts`
**Depends on:** Subtask 3 (SDK v0.5.0 published)
**Estimate:** Large

Implement each new optional method using CourseBuilder's data model:

| Method | CB Data Source | Implementation Notes |
|--------|---------------|---------------------|
| `getActivePromotions` | `Coupon` table + `MerchantCoupon` | Query coupons where `expires > now() OR expires IS NULL` and `status=0` (active). Join `MerchantCoupon` for Stripe identifier. Use `fields` JSON for PPP/student metadata |
| `getCouponInfo` | `Coupon` table (by `code`) | `db.select().from(coupon).where(eq(coupon.code, code))`. Map `percentageDiscount`/`amountDiscount` to SDK type. Check `usedCount` vs `maxUses` for validity |
| `getRefundPolicy` | Static config / env | Return hardcoded policy object. Source `auto_approve_refund_days` from env or config file. No per-product policy in DB |
| `getContentAccess` | `Entitlement` + `ContentResourceProduct` + `Purchase` | Query entitlements by userId → join entitlement types → map to SDK `ContentAccess`. **Richest implementation** — can show per-resource access via entitlements |
| `getRecentActivity` | `ResourceProgress` table | `db.select().from(resourceProgress).where(eq(userId)).orderBy(desc(createdAt)).limit(10)`. Count completions vs total resources. No device/login tracking available |
| `getLicenseInfo` | `Organization` + `OrganizationMembership` + `Purchase` | Query org by purchase's `organizationId` → get members via `OrganizationMembership`. Map role to SDK role. **Different from TT** — org-based, not coupon-based |
| `getAppInfo` | Static config | Return app name, instructor, URLs from env/config |

**Additional work:**
- Add AI Hero to support platform `SUPPORT_apps` seed data
- Set capabilities: `['lookup_user', 'get_purchases', 'revoke_access', 'transfer_purchase', 'generate_magic_link', 'update_email', 'update_name', 'search_content', 'get_product_status', 'get_active_promotions', 'get_coupon_info', 'get_refund_policy', 'get_content_access', 'get_recent_activity', 'get_license_info', 'get_app_info']`

---

#### Subtask 10: Total TypeScript — Implement New SDK Methods 🆕
**Repo:** `skillrecordings/products`
**Files:** `apps/total-typescript/src/lib/support-integration.ts`
**Depends on:** Subtask 3 (SDK v0.5.0 published)
**Estimate:** Large

Implement each new optional method using TT's Prisma data model:

| Method | TT Data Source | Implementation Notes |
|--------|---------------|---------------------|
| `getActivePromotions` | `Coupon` model + `MerchantCoupon` | `prisma.coupon.findMany({ where: { OR: [{ expires: { gt: new Date() }}, { expires: null }], status: 0 }, include: { merchantCoupon: true, product: true } })`. Map `percentageDiscount` to SDK type. Infer restriction type from `MerchantCoupon.type` |
| `getCouponInfo` | `Coupon` model (by `code`) | `prisma.coupon.findUnique({ where: { code } })`. Check `usedCount < maxUses` for validity |
| `getRefundPolicy` | Static config | Same as AI Hero — return from config/env |
| `getContentAccess` | `Purchase` model + `Product` | Simpler than AI Hero — query valid purchases → list products with access. No entitlements layer, so `accessLevel` is binary: 'full' if Valid purchase exists, 'expired' if Refunded |
| `getRecentActivity` | `LessonProgress` model | `prisma.lessonProgress.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 10 })`. Count `completedAt IS NOT NULL` for completion stats |
| `getLicenseInfo` | `Coupon` (bulk) + `Purchase` | Find purchase's `bulkCouponId` → count redeemed purchases → calculate seats. Reuse `getClaimedSeats` logic internally. Admin = original bulk purchase owner |
| `getAppInfo` | Static config | Return TT name, Matt Pocock, URLs |

**Additional work:**
- Update capabilities in seed: add `'search_content', 'get_product_status', 'get_active_promotions', 'get_coupon_info', 'get_refund_policy', 'get_content_access', 'get_recent_activity', 'get_license_info', 'get_app_info'`
- Add tests to `src/lib/__tests__/support-integration.test.ts` for each new method
- Update `npm update @skillrecordings/sdk` to get v0.5.0

---

#### Subtask 11: Support Platform Seed & Config Update 🆕
**Repo:** `skillrecordings/support`
**Files:** `packages/database/src/seed.ts`
**Depends on:** Subtasks 9 + 10
**Estimate:** Small

- Add AI Hero app to seed data with full capabilities list
- Update TT capabilities to include `search_content`, `get_product_status`, and all new methods
- Verify `auto_approve_refund_days` and `auto_approve_transfer_days` defaults

---

#### Subtask 12: Integration Testing 🆕
**Repo:** `skillrecordings/support`
**Files:** `packages/core/src/**/__tests__/`, eval tests
**Depends on:** All previous subtasks
**Estimate:** Medium

Testing plan:
1. **SDK unit tests** — verify client sends correct action payloads, handler routes correctly, 501 fallback works
2. **Agent tool tests** — mock SDK client, verify each tool calls correct method with right params
3. **Gather step tests** — verify category-aware data fetching (e.g., `support_refund` triggers `getRefundPolicy`)
4. **End-to-end eval** — run eval suite with new tools available, verify:
   - `presales_faq` conversations now get promotion/coupon data
   - `support_refund` conversations use dynamic policy
   - `support_access` conversations get content access data
   - `presales_team` conversations get license info
5. **Integration smoke test** — call each new method on deployed TT and AI Hero apps
6. **Fallback test** — verify agent handles 501 gracefully when app hasn't implemented optional method

---

### Dependency Graph

```
Subtask 1 (SDK Types)
    └─▶ Subtask 2 (SDK Client/Handler)
          └─▶ Subtask 3 (Changeset & Publish)
                ├─▶ Subtask 9 (AI Hero Implementation)
                └─▶ Subtask 10 (TT Implementation)
                      └─▶ Subtask 11 (Seed/Config Update)
                            └─▶ Subtask 12 (Integration Testing)

Subtask 4 (Wire updateEmail/Name) — independent, can start immediately
Subtask 5 (P0 Agent Tools) ← depends on Subtask 2
Subtask 6 (P1 Agent Tools) ← depends on Subtask 2
Subtask 7 (Gather Step) ← depends on Subtasks 5+6
Subtask 8 (Draft Prompts) ← depends on Subtask 7
```

### Parallelization Opportunities

- **Subtasks 1+2** can be done together (same PR)
- **Subtasks 4, 5, 6** can start as soon as Subtask 2 lands (parallel)
- **Subtasks 9 + 10** are in different repos — fully parallel
- **Subtask 3** blocks 9+10 but not 4-8 (agent tools use client internally, not published npm)
