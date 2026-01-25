# Front Message Templates & Agent-Assisted Gardening

Research findings on Front's template API and proposed agent-assisted template management.

## Executive Summary

The front-sdk **already has full CRUD support** for Front message templates. The gap is in *using* these templates effectively within the agent workflow and automating template maintenance.

---

## Part 1: Front API Capabilities

### Template Operations (Already Implemented in front-sdk)

```typescript
// packages/front-sdk/src/client/templates.ts
const client = createFrontClient(apiKey)

// List all templates
await client.templates.list()

// Get specific template
await client.templates.get('rsp_xxx')

// Create template (with inbox scoping!)
await client.templates.create({
  name: 'Refund Confirmation',
  subject: 'Your refund has been processed',
  body: 'Hi {{customer_name}},\n\nYour refund of {{amount}} has been processed...',
  folder_id: 'fld_xxx',
  inbox_ids: ['inb_totaltypescript']  // Per-inbox scoping!
})

// Update template
await client.templates.update('rsp_xxx', { body: '...' })

// Delete template
await client.templates.delete('rsp_xxx')

// Folder operations
await client.templates.listFolders()
await client.templates.createFolder('TotalTypeScript')
```

### Key API Features

| Feature | Supported | Notes |
|---------|-----------|-------|
| Per-inbox scoping | ✅ | Via `inbox_ids` array |
| Folders | ✅ | Full CRUD |
| Variable placeholders | ✅ | Front's native `{{variable}}` syntax |
| Attachments | ✅ | Can include files |
| Subject templates | ✅ | Separate from body |

---

## Part 2: Current State

### What We Have Today

1. **Vector-based canned responses** (`packages/core/src/router/canned.ts`)
   - `matchCannedResponse()` - Similarity search against vector store
   - `interpolateTemplate()` - Variable replacement
   - Stored with `type="response"` in vector DB

2. **Context retrieval** (`packages/core/src/vector/retrieval.ts`)
   - `buildAgentContext()` returns `goodResponses` array
   - Passed to agent as "Good Response Examples"

3. **Agent drafting** (`packages/core/src/pipeline/steps/draft.ts`)
   - Category-specific prompts (support_refund, support_access, etc.)
   - Generates fresh drafts using context + prompts
   - No direct template insertion

### Architecture Mismatch

```
Current:
  Message → Classify → Gather → Draft (fresh generation) → Approve

Ideal:
  Message → Classify → Match Template? 
    ├─ Yes (high confidence): Use template → Quick approve
    └─ No: Gather → Draft → Approve → Learn
```

### Gap Analysis

| Gap | Impact | Priority |
|-----|--------|----------|
| Front templates unused | Manual management only | High |
| No sync between Front ↔ vector | Duplicate effort | High |
| No usage analytics | Can't optimize templates | Medium |
| No pattern discovery | Miss templating opportunities | Medium |
| No edit tracking | Human improvements lost | Medium |
| No stale detection | Cruft accumulates | Low |

---

## Part 3: Proposed Gardening Workflows

### 1. Template Sync (Foundation)

Sync Front templates to vector store for semantic search:

```typescript
// packages/core/src/templates/sync.ts
export async function syncTemplates(appId: string) {
  const front = createFrontClient(config.frontApiKey)
  const templates = await front.templates.list()
  
  for (const template of templates._results) {
    await upsertVector({
      id: template.id,
      type: 'response',
      appId,
      data: template.body,
      metadata: {
        name: template.name,
        subject: template.subject,
        source: 'front_template'
      }
    })
  }
}
```

### 2. Pattern Discovery (Passive Learning)

Track draft fingerprints to identify template candidates:

```typescript
// After each draft generation
await recordDraftPattern({
  appId,
  category: classification.category,
  draftHash: hashStructure(draft),
  embedding: await embed(redactPII(draft))
})

// Daily job clusters similar drafts
const candidates = await findTemplateCandidates({
  appId,
  minClusterSize: 5,
  minSimilarity: 0.9
})
```

### 3. Edit Learning Loop

Track when humans improve agent drafts:

```typescript
// When draft is sent (after possible edits)
const editDistance = calculateSemanticDiff(agentDraft, sentMessage)

if (editDistance > SIGNIFICANT_EDIT_THRESHOLD) {
  await storeImprovement({
    original: agentDraft,
    improved: sentMessage,
    category,
    appId
  })
}
```

### 4. Template Health Monitoring

Flag stale or underperforming templates:

```typescript
// Weekly job
const staleTemplates = await findStaleTemplates({
  unusedDays: 60,
  appId
})

for (const template of staleTemplates) {
  await addFrontComment({
    conversationId: null,  // System notification
    body: `Template "${template.name}" hasn't been used in 60+ days. Review or archive?`
  })
}
```

### 5. Per-Inbox Organization

Structure templates by product:

```
Front Templates/
├── TotalTypeScript/
│   ├── Refunds/
│   │   ├── Standard Refund (30-day)
│   │   └── Extended Refund Request
│   ├── Access Issues/
│   │   ├── Magic Link
│   │   └── GitHub Login Help
│   └── Technical/
│       └── Discord Redirect
├── ProTailwind/
│   └── ...
└── Shared/
    ├── Thanks for Patience
    └── Will Follow Up
```

---

## Part 4: Implementation Epic

### Phase 1: Foundation (1-2 weeks)

| Task | Files | Priority |
|------|-------|----------|
| Template sync service | `packages/core/src/templates/sync.ts` | P0 |
| Template CRUD wrapper | `packages/core/src/templates/client.ts` | P0 |
| Usage analytics schema | Database migration | P1 |

### Phase 2: Discovery (2-3 weeks)

| Task | Files | Priority |
|------|-------|----------|
| Draft fingerprinting | `packages/core/src/templates/fingerprint.ts` | P1 |
| Cluster analysis job | `packages/core/src/inngest/workflows/template-discovery.ts` | P1 |
| Template matching in classify | `packages/core/src/pipeline/steps/classify.ts` | P2 |

### Phase 3: Learning (2-3 weeks)

| Task | Files | Priority |
|------|-------|----------|
| Edit tracking | `packages/core/src/templates/edit-tracker.ts` | P2 |
| Improvement storage | `packages/core/src/templates/improvements.ts` | P2 |
| Stale detection | `packages/core/src/inngest/workflows/template-health.ts` | P3 |

### Phase 4: UX (1-2 weeks)

| Task | Files | Priority |
|------|-------|----------|
| "Save as template" suggestion | `packages/core/src/templates/suggestions.ts` | P2 |
| Template dashboard | `packages/web/` | P3 |

---

## Recommendations

1. **Start with sync** - Get Front templates into vector store ASAP
2. **Fingerprint everything** - Passive data collection costs little
3. **Don't auto-create templates** - Surface candidates, let humans decide
4. **Track edits** - Gold mine for improvement
5. **Per-inbox folders** - Use Front's native organization

---

## Related Code Locations

- Front SDK templates: `packages/front-sdk/src/client/templates.ts`
- Template schemas: `packages/front-sdk/src/schemas/template.ts`
- Canned response matching: `packages/core/src/router/canned.ts`
- Vector retrieval: `packages/core/src/vector/retrieval.ts`
- Draft generation: `packages/core/src/pipeline/steps/draft.ts`
- Agent config: `packages/core/src/agent/config.ts`
