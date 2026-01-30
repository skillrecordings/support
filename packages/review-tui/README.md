# FAQ Review TUI

Terminal UI for reviewing FAQ candidates mined from support conversations.

## Screenshot

```
┌─ FAQ Review ═════════════════════════════════════════════┐
│ [Total TypeScript] │ 45 pending │ 12 ✓ │ 3 ✗            │
├──────────────────────────────────────────────────────────┤
│ ▸ How do I transfer my license?          [0.87] cluster:5│
│   Can I get a refund after 30 days?      [0.72] cluster:2│
│   Magic link not working                 [0.65] cluster:8│
├──────────────────────────────────────────────────────────┤
│ Question:                                                │
│ How do I transfer my license to a new email?             │
│                                                          │
│ Answer:                                                  │
│ To transfer your license, please reply with the new      │
│ email address and I'll process the transfer for you.     │
│                                                          │
│ Confidence: 0.87 │ Cluster: 5 │ Sources: 47 convos       │
├──────────────────────────────────────────────────────────┤
│ [a]pprove [e]dit [r]eject [s]kip [j/k]nav [?]help [q]uit │
└──────────────────────────────────────────────────────────┘
```

## Installation

```bash
cd packages/review-tui
bun install
```

## Usage

```bash
# From packages/review-tui
bun run start

# From repo root
bun run review-tui
```

## Requirements

- **Bun** runtime
- **Zig** (for OpenTUI native bindings): `zig version`
- Environment variables:
  - `UPSTASH_REDIS_REST_URL`
  - `UPSTASH_REDIS_REST_TOKEN`

These are typically set in `.env.local` at the repo root.

## Keybindings

| Key | Action |
|-----|--------|
| `j` / `↓` | Next candidate |
| `k` / `↑` | Previous candidate |
| `a` | Approve candidate (publishes to knowledge base) |
| `e` | Edit answer in $EDITOR, then approve |
| `r` | Reject candidate |
| `s` | Skip (move to next without action) |
| `1-6` | Switch between apps |
| `?` | Show/hide help |
| `q` | Quit |

## Apps

| Key | App |
|-----|-----|
| `1` | Total TypeScript |
| `2` | Epic Web |
| `3` | Epic React |
| `4` | Testing JavaScript |
| `5` | Just JavaScript |
| `6` | Product Engineer |

## How It Works

1. The FAQ mining pipeline generates candidates from resolved support conversations
2. Candidates are stored in Redis queues (`faq:pending:{appId}`)
3. This TUI reads from those queues and lets you review each candidate
4. **Approve** → publishes to the knowledge base, moves to `faq:approved:{appId}`
5. **Edit** → opens your `$EDITOR` to modify the answer, then approves
6. **Reject** → moves to `faq:rejected:{appId}` (for analysis)

## Data Flow

```
Support Conversations
        ↓
  FAQ Mining Pipeline
        ↓
  Redis: faq:pending:{appId}
        ↓
   Review TUI (you are here!)
        ↓
  Approve → Knowledge Base
  Reject → faq:rejected:{appId}
```

## Development

The TUI uses:
- **OpenTUI** (`@opentui/solid`) for terminal rendering
- **SolidJS** signals for reactive state
- **@skillrecordings/core** for Redis integration and review logic

Key files:
- `src/index.tsx` - Entry point
- `src/components/App.tsx` - Main component with keyboard handling
- `src/components/CandidateList.tsx` - Scrollable candidate list
- `src/components/CandidateDetail.tsx` - Full candidate view
- `src/lib/editor.ts` - $EDITOR integration

## Troubleshooting

### "Missing required environment variables"

Make sure you have `.env.local` in the repo root with:

```bash
UPSTASH_REDIS_REST_URL=https://xxx.upstash.io
UPSTASH_REDIS_REST_TOKEN=xxx
```

### OpenTUI build errors

OpenTUI requires Zig. Install with:

```bash
# macOS
brew install zig

# Linux (Ubuntu/Debian)
sudo snap install zig --classic --beta

# Or download from https://ziglang.org/download/
```

### Editor doesn't open

Set `$EDITOR` environment variable:

```bash
export EDITOR=nano  # or vim, code --wait, etc.
```
