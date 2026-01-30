# Phase 0 Decisions

**Generated:** 2026-01-30
**Epic:** #94 (FAQ Mining from Front Cache)
**Awaiting:** Human approval

---

## Clustering Strategy

**Decision:** Use **hybrid approach** — tags as primary grouping + clusters for discovery

**Rationale:**
- 66% noise in HDBSCAN clustering makes pure cluster approach unreliable
- Existing tags have established semantic meaning and resolution metrics
- Clusters reveal sub-patterns within tags (e.g., Epic React refunds vs Testing JavaScript refunds)
- Golden responses are easier to attribute to tags than clusters

**Implications:**
- Phase 1 pipelines will query by tag first, then optionally by cluster
- FAQ namespaces will align with existing tag taxonomy
- Cluster analysis remains useful for discovering new FAQ candidates

---

## Quality Thresholds

| Threshold | Value | Justification |
|-----------|-------|---------------|
| **Minimum cluster size** | 30 | HDBSCAN min_cluster_size param; smaller clusters are noise |
| **Golden response reuse count** | ≥3 | Proves pattern is effective, not one-off |
| **Golden response min length** | 100 chars | Filters auto-acks and minimal responses |
| **Max thread length for golden** | 10 messages | Longer threads indicate edge cases |
| **Quick resolution threshold** | ≤3 messages | Industry standard for "resolved" |
| **High-friction threshold** | >4.0 avg messages OR <50% quick resolution | Targets worst performers |

---

## Topic Priorities

### Tier 1: Extract First (Critical)

1. **Email Transfer** (1,947 conversations, 279 long threads)
   - Why first: Largest single cluster, clear self-service potential
   - Golden response coverage: High (cluster 64 has templates)
   - Estimated FAQ items: 5-8

2. **Magic Link / Login Issues** (616 conversations, 112 long threads)
   - Why second: Authentication is foundational to all access
   - Known patterns: spam folder, email provider delays, browser issues
   - Estimated FAQ items: 8-12

3. **Invoice/Receipt Requests** (649 conversations, highest avg thread length)
   - Why third: High friction on common request
   - Self-service opportunity: Link to existing invoice system
   - Estimated FAQ items: 3-5

### Tier 2: Extract Second (High Volume)

4. **Refund Process** (955 conversations)
   - Clear policy documentation opportunity
   - Golden response coverage: Good (27 refund templates)
   - Estimated FAQ items: 4-6

5. **Course Access Issues** (215 conversations, 50.7% quick resolution)
   - Below-average resolution rate indicates complexity
   - Product-specific variations needed
   - Estimated FAQ items: 6-10

6. **PPP Questions** (579 conversations)
   - Complex but documented policy
   - Regional variations require care
   - Estimated FAQ items: 5-8

### Tier 3: Extract Later (Lower Priority)

7. **Student/Discount Requests** — clear policy, simple FAQ
8. **Certificate of Completion** — technical issues, troubleshooting guide
9. **Video Player Issues** — browser-specific troubleshooting
10. **Team Plan Questions** — complex but lower volume

---

## Out of Scope

| Topic | Reason for Deferral |
|-------|---------------------|
| **Bug reports** | Spiky, incident-driven; not FAQ-able, needs triage not templates |
| **Spam/outreach** (cluster 46) | Filter, don't FAQ |
| **Egghead comments** (cluster 48) | Different product, different workflow |
| **Product feedback** | Route to product, not support |
| **Code questions** | Too technical for templated responses |
| **Price objections** | Sales decision, not support FAQ |

---

## Product Namespaces

**Decision:** Create separate FAQ namespaces per product family

| Namespace | Products | Tags |
|-----------|----------|------|
| `kcd` | Epic React, Epic Web, Testing JavaScript | ER, Testing JavaScript, KCD Bundle |
| `totaltypescript` | Total TypeScript, AI Hero | Total TypeScript, Epic AI |
| `egghead` | egghead.io | egghead.io |
| `shared` | Cross-product topics | Email Transfer, invoice, refund, magic link |

**Rationale:**
- Different products have different policies, pricing, and platforms
- Golden responses often reference specific product features
- Reduces confusion when FAQs reference "your course"

---

## Phase 1 Scope Adjustments

Based on Phase 0 findings, adjusting original Phase 1 plan:

### Added
- [ ] Spam filtering step before extraction
- [ ] Product namespace routing
- [ ] Golden response age filtering (exclude pre-2024 for policy questions)

### Removed
- [ ] Pure cluster-based extraction (hybrid approach instead)
- [ ] Automatic FAQ publication (human review checkpoint remains)

### Unchanged
- [ ] DuckDB as data source
- [ ] Embedding-based semantic search for FAQ matching
- [ ] Human review workflow for FAQ approval

---

## Success Metrics for Phase 1

| Metric | Target | Measurement |
|--------|--------|-------------|
| FAQ coverage (Tier 1 topics) | 80% | % of Tier 1 conversations matchable to FAQ |
| Quick resolution improvement | +10% | Compare pre/post FAQ resolution rates |
| Golden response reuse | 50+ | Times FAQ templates used in responses |
| Human review turnaround | <48h | Time from FAQ candidate to approval |

---

## Approval Required

**Human checkpoint:** This document requires explicit approval before Phase 1 begins.

**To approve:** Comment "APPROVED" on issue #100

**Questions for review:**
1. Do the priority rankings align with support team's pain points?
2. Are any critical topics missing from Tier 1?
3. Do the quality thresholds seem reasonable?
4. Is the product namespace strategy correct?

---

*Generated by Phase 0 synthesis task*
