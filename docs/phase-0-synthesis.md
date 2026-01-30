# Phase 0 Synthesis Report

**Generated:** 2026-01-30
**Epic:** #94 (FAQ Mining from Front Cache)

## Executive Summary

- **99.1% embedding coverage** (25,806 of 26,028 conversations) — data quality is excellent
- **71 natural clusters discovered** — but 66% noise means tags remain essential for topic grouping
- **91 golden responses** identified with 9 reusable templates — solid foundation for FAQ seeding
- **78.8% quick resolution rate** — but 1,939 long threads (7.3%) represent high-friction opportunities
- **Primary recommendation:** Hybrid approach using tags for known topics + clusters for discovery

## Data Quality Assessment

| Metric | Value | Assessment |
|--------|-------|------------|
| Embedding coverage | 99.1% (25,806/26,028) | ✅ Excellent |
| Skipped (empty) | 222 | Acceptable |
| Failed | 0 | ✅ Perfect |
| Embedding cost | $0.13 | Negligible |
| Model | text-embedding-3-small | Cost-effective choice |

### Clustering Quality

| Metric | Value | Assessment |
|--------|-------|------------|
| Clusters discovered | 71 | Good diversity |
| Silhouette score | 0.35 | Moderate (expected for support data) |
| Noise points | 17,074 (66.2%) | High but typical for HDBSCAN |
| Largest cluster | 5.3% (1,365 items) | Email changes dominate |

**Interpretation:** The high noise percentage is expected with HDBSCAN on support data — conversations don't always form tight semantic clusters. This confirms we need a **hybrid approach** using existing tags for known topics.

### Golden Response Yield

| Metric | Value |
|--------|-------|
| Golden responses | 91 |
| Reusable templates | 9 |
| Avg quality score | 0.426 |
| Avg reuse count | 11 |

**Topic distribution of golden responses:**
- Refund: 27
- General: 25  
- Discount: 12
- Access: 8
- Community: 8
- Invoice: 4
- Download: 3
- License: 2
- Transfer: 2

## Topic Landscape

### Natural Clusters (Top 15 by Size)

| Cluster | Size | Label | Notes |
|---------|------|-------|-------|
| 64 | 1,365 | Email Change | Massive — self-service opportunity |
| 48 | 689 | Lesson Comments | Egghead-specific, mostly automated |
| 51 | 593 | Matt Price | Price objections for TotalTypeScript |
| 69 | 504 | Epic React | Product-specific support |
| 58 | 171 | Kent Student | EpicWeb student discounts |
| 70 | 178 | Epic React Refunds | Refund flow patterns |
| 55 | 123 | Matt $1800 | High price point objections |
| 63 | 118 | React Learn Iran | Regional access issues |
| 68 | 145 | Course Refund | Generic refund requests |
| 59 | 154 | Kent Discount | Returning student pricing |
| 62 | 98 | Email Course | Access after purchase |
| 65 | 67 | Login Trying | Magic link issues |
| 67 | 69 | Link Working | Login link problems |
| 47 | 70 | Refund Hello | Simple refund requests |
| 46 | 216 | Spam/Influencer Outreach | Noise to filter |

### High-Friction Topics (by Resolution Metrics)

**Critical (avg >5.5 messages OR <30% quick resolution):**
- `quote` — 6.62 avg messages, 17.2% quick resolution
- `404s-while-logged-in` — 6.13 avg messages, 29.2% quick resolution
- `pending webhook` — 5.07 avg messages, 29.5% quick resolution

**High Priority (high volume + many long threads):**
| Tag | Conversations | Long Threads | Avg Length | Quick Resolution |
|-----|---------------|--------------|------------|------------------|
| ER (Epic React) | 7,857 | 1,026 | 3.69 | 62.9% |
| Email Transfer | 1,947 | 279 | 3.80 | 59.5% |
| invoice or receipt | 649 | 128 | 4.18 | 59.9% |
| magic link | 616 | 112 | 3.82 | 58.3% |
| parity purchase power | 579 | 96 | 3.97 | 52.2% |
| 🐛 bug | 693 | 135 | 4.04 | 57.3% |
| course access | 215 | 58 | 4.17 | 50.7% |
| credit card issue | 180 | 37 | 4.09 | 52.8% |

### Tag-Cluster Alignment

**Existing tags cover most high-volume topics well.** The clusters primarily reveal:
1. **Product-specific patterns** within generic tags (e.g., Epic React vs Testing JavaScript refunds)
2. **Spam/outreach noise** that can be filtered
3. **Regional patterns** (Iran, Brazil, India) tied to PPP requests
4. **Price objection patterns** by product and price point

## Priority Recommendations

| Priority | Topic | Rationale | Cluster Evidence |
|----------|-------|-----------|------------------|
| 🔴 Critical | Email Transfer | 1,947 conversations, 279 long threads, clear self-service opportunity | Cluster 64: 1,365 items |
| 🔴 Critical | Magic Link / Login | 616 conversations, 112 long threads, authentication pain point | Clusters 65, 67: 136 items |
| 🟠 High | Invoice/Receipt | 649 conversations, longest avg thread (9.16 in long threads) | Cluster 60: 58 items |
| 🟠 High | Refund Process | 955 requests + 773 completed, high volume but okay resolution | Clusters 47, 68, 70: 393 items |
| 🟠 High | Course Access | 215 conversations, 50.7% quick resolution (below avg) | Cluster 62: 98 items |
| 🟡 Medium | PPP Questions | 579 conversations, complex manual review | Regional clusters |
| 🟡 Medium | Student Discounts | Clear pattern, simple to document | Clusters 54, 58: 220 items |
| 🟢 Low | Bug Reports | Spiky, incident-driven, not FAQ-able | N/A |

## FAQ Extraction Strategy

### Recommended: Hybrid Approach

**Use existing tags as primary grouping** because:
1. Tags have semantic meaning understood by humans
2. Resolution metrics are tied to tags
3. High noise in clustering (66%) makes pure cluster approach unreliable

**Use clusters for:**
1. Discovering sub-patterns within high-volume tags
2. Finding golden responses within similar conversations
3. Identifying spam/noise to filter

### Extraction Thresholds

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| Minimum cluster size | 30 | HDBSCAN param, balances signal/noise |
| Golden response reuse | 3+ times | Indicates proven effective pattern |
| Golden response length | 100+ chars | Filters auto-acks |
| Max thread length for golden | 10 messages | Focus on resolvable issues |

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Cluster noise hides valid patterns | Medium | Medium | Hybrid approach using tags as anchors |
| Golden responses outdated | Low | High | Filter by date, validate against current products |
| Spam clusters contaminate FAQ | Medium | Low | Explicit spam filtering (cluster 46: influencer outreach) |
| Product-specific FAQs diverge | Medium | Medium | Separate FAQ namespaces per product |

## Phase 1 Adjustments

Based on Phase 0 findings, recommend the following changes:

1. **Prioritize tag-based extraction over cluster-based** for high-friction topics
2. **Add spam detection step** before FAQ extraction (influencer outreach cluster is significant)
3. **Create product-specific FAQ namespaces** (Epic React, Testing JavaScript, TotalTypeScript have distinct patterns)
4. **Focus first on Email Transfer** — single largest cluster with clear self-service potential
5. **Track golden response age** — some templates reference outdated pricing/policies

## Artifact Inventory

| Artifact | Path | Status |
|----------|------|--------|
| Embeddings stats | `artifacts/phase-0/embeddings/v1/stats.json` | ✅ Complete |
| Cluster labels | `artifacts/phase-0/clusters/v1/labels.json` | ✅ Complete |
| Cluster metrics | `artifacts/phase-0/clusters/v1/metrics.json` | ✅ Complete |
| Cluster assignments | `artifacts/phase-0/clusters/v1/assignments.json` | ✅ Complete |
| Golden responses | `artifacts/phase-0/golden/v1/responses.json` | ✅ Complete |
| Golden stats | `artifacts/phase-0/golden/v1/stats.json` | ✅ Complete |
| Resolution metrics | `artifacts/phase-0/metrics/v1/resolution.json` | ✅ Complete |
| Co-occurrence | `artifacts/phase-0/metrics/v1/cooccurrence.json` | ✅ Complete |
| Temporal patterns | `artifacts/phase-0/metrics/v1/temporal.json` | ✅ Complete |
