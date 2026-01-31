# Phase 0 Cluster Quality Diagnosis Report

**Date:** 2026-01-31
**Issue:** #110
**Author:** Grimlock (Agent)

---

## Executive Summary

FAQ extraction (PR #109) yielded only **6 high-confidence candidates out of 46** (13% success rate). After auditing Phase 0 clustering artifacts, the root cause is clear:

**The Phase 0 pipeline is clustering ALL inbound emails without any preprocessing or spam filtering.** This results in:
- 66% noise rate (17,074 of 25,816 conversations in noise cluster -1)
- ~40% of named clusters are pure service notifications/spam
- Zero tag coverage on ALL clusters (preprocessing didn't preserve tag data)

---

## Cluster Audit Results

### Noise Categories Identified

| Category | Clusters | Total Messages | Example Content |
|----------|----------|----------------|-----------------|
| **Service Notifications** | 1,2,3,4,5,6,7,10,11,20 | 1,098 | CastingWords, DMARC, AWS, Google Workspace invoices |
| **Auto-Replies** | 0,13,14,15,16,17 | 511 | QQ vacation replies, Mixmax, Jira, French training platform |
| **Marketing Analytics** | 8,9,12,22 | 219 | Google Analytics tips, sign-in notifications, DMARC digests |
| **Outreach/Spam** | 46 | 216 | Head AI influencer cold emails |
| **Newsletter Replies** | 37 | 105 | ConvertKit newsletter forwards |
| **Calendar Notifications** | 33 | 106 | "X has accepted this invitation" |
| **Lesson Comments** | 48 | 689 | egghead.io lesson comments (not support) |
| **Campaign Replies** | 51,55 | 716 | Price objections to marketing emails |

**Total noise in named clusters: ~3,660 messages (41% of clustered data)**

### Legitimate Support Clusters

| Cluster | Label | Size | Quality |
|---------|-------|------|---------|
| 64 | Email Change | 1,365 | ✅ High - clear email transfer requests |
| 69 | Epic React | 504 | ✅ High - product inquiries |
| 70 | Epic React | 178 | ✅ High - refund requests |
| 68 | Course Refund | 145 | ✅ High - refund requests |
| 58 | Kent Student | 171 | ✅ Medium - discount requests |
| 59 | Kent Discount | 154 | ✅ Medium - discount requests |
| 27 | Invoice Receipt | 120 | ⚠️ Mixed - may include noise |
| 65 | Login Issues | 67 | ✅ High - auth troubleshooting |

**Estimated legitimate FAQ-able content: ~2,700 messages (30% of clustered data)**

---

## Root Cause Analysis

### 1. No Sender Domain Filtering

The pipeline processes ALL emails including:
- `castingwords.com` - transcription service
- `postmarkapp.com` - email service status
- `google.com` / `google.co.uk` - workspace invoices
- `convertkit.com` - email service receipts
- `algolia.com` - search service reports
- `mux.com` - video service invoices
- `cloudinary.com` - image service reports
- `aws.amazon.com` - cloud billing

### 2. No Auto-Reply Detection

Messages with patterns like:
- "这是来自QQ邮箱的假期自动回复邮件" (QQ vacation auto-reply)
- "Invitation from Google Calendar"
- "uses Mixmax to route first-time outreach"
- "Just confirming that we got your request" (Jira)

### 3. No Tag Coverage Signal

ALL 71 clusters have `tag_coverage: 0.0` - the preprocessing step didn't preserve human-applied tags. This means we can't use the existing tagging signal that humans already spent effort on.

### 4. Marketing Email Replies Included

Replies to outbound marketing emails ("What's holding you back from buying?") are clustered as if they were support requests. These are price objections and feedback, not FAQ-able support patterns.

---

## Impact on Extraction

Current extraction results:
```
Total candidates:        46
High confidence (≥0.7):  6    (13%)
Average confidence:      55.6%
Golden match rate:       13%
Noise skipped:          17,074
```

Top 10 candidates include:
1. ✅ Course Refund (75.7%) - legitimate
2. ⚠️ Epic React access with forwarded email (73.9%) - noisy question text
3. ✅ Login link issues (72.3%) - legitimate
4. ✅ Total TypeScript refund (72.2%) - legitimate
5. ✅ Epic React refund (71.0%) - legitimate
6. ✅ Email Change (70.0%) - legitimate
7. ⚠️ Matt 1800 pricing complaints (61.7%) - marketing reply noise
8. ⚠️ Matt Price objections (61.4%) - marketing reply noise
9. ❌ CastingWords transcription (60.2%) - pure noise
10. ❌ Head AI outreach (60.2%) - spam

---

## Recommendations

### Immediate Fixes (Quick Wins)

#### 1. Add Sender Domain Blocklist

Create `packages/core/src/faq/filters.ts`:
```typescript
export const NOISE_SENDER_DOMAINS = [
  'castingwords.com',
  'postmarkapp.com', 
  'algolia.com',
  'cloudinary.com',
  'mux.com',
  'aws.amazon.com',
  'google.com',
  'google.co.uk',
  'convertkit.com',
  'kit.com',
  'stripe.com',
  'placedelaformation.com',
  'allwyn-lotterysolutions.com',
]
```

**Expected impact:** Filter ~1,500+ noise messages before clustering

#### 2. Add Auto-Reply Pattern Detection

```typescript
export const AUTO_REPLY_PATTERNS = [
  /这是.*自动回复/,  // Chinese auto-reply
  /vacation.*auto.*reply/i,
  /out of office/i,
  /has accepted this invitation/i,
  /uses Mixmax to route/i,
  /Just confirming that we got your request/i,
]
```

**Expected impact:** Filter ~600+ auto-reply noise

#### 3. Exclude Lesson Comments

Filter messages matching:
```typescript
/^.* writes:.*--- lesson:/s  // egghead lesson comment format
```

**Expected impact:** Filter 689 lesson comments

#### 4. Add Cluster Quality Scoring

Post-clustering, score clusters by:
- Tag coverage (0% = suspicious)
- Sender domain diversity (low = likely template noise)
- Message length variance (low = likely automated)

### Medium-Term Improvements

#### 5. Preserve Tags During Preprocessing

The current pipeline loses tag data. Tags should be preserved and used for:
- Cluster quality validation
- FAQ namespace routing
- Golden response matching

#### 6. Separate Marketing Reply Pipeline

Replies to outbound marketing emails should be:
- Routed to a separate "feedback" pipeline
- Not included in support FAQ extraction

### Metrics After Fixes (Estimated)

| Metric | Current | After Fixes |
|--------|---------|-------------|
| Noise in clusters | ~41% | <5% |
| High-confidence candidates | 6 | 15-20 |
| Avg confidence | 55.6% | 70%+ |
| FAQ coverage (Tier 1) | ~30% | 70%+ |

---

## Implementation Plan

1. **Create `filters.ts`** with sender blocklist and pattern detection
2. **Update `production-clusterer.ts`** to apply filters before clustering
3. **Add filter stats** to clustering output for monitoring
4. **Re-run Phase 0** clustering with filters
5. **Re-run extraction** and compare results

---

## Files to Modify

- `packages/core/src/faq/filters.ts` (new)
- `packages/core/src/faq/production-clusterer.ts`
- `packages/cli/src/commands/faq-cluster.ts`

---

## Appendix: Sample Noise Messages

### CastingWords (cluster 3, size 230)
```
Hi Total,
We've just finished your transcription, "31 as const". The transcript is available...
```

### QQ Auto-Reply (cluster 14, size 120)
```
这是来自QQ邮箱的假期自动回复邮件。您好，我最近正在休假中，无法亲自回复您的邮件。
```

### Head AI Spam (cluster 46, size 216)
```
Hi Matt, I hope you're having a great day. My name is Francis, and I'm reaching 
out from Head, an AI-powered influencer agency...
```

### Calendar Acceptance (cluster 33, size 106)
```
Jacob Fifhause has accepted this invitation. Workshop: MCP Fundamentals...
```
