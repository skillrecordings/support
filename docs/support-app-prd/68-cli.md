# CLI (skill)

The CLI is the primary agentic interface. Claude Code and OpenCode agents use it to investigate and act.

## Operator Commands

```bash
skill lookup [EMAIL] --app tt
skill purchases [EMAIL] --app tt
skill conversation cnv_abc123
skill history [EMAIL] --app tt

skill refund ch_xxx --app tt --reason "requested"
skill transfer pur_xxx --to [EMAIL] --app tt
skill magic-link [EMAIL] --app tt
skill cancel-subscription sub_xxx --app tt
```

## Agent Mode

```bash
skill agent --context cnv_abc123
skill agent --json "refund the last charge for [EMAIL] on total-typescript"
echo '{"task": "investigate access issue", "email": "[EMAIL]"}' | skill agent --json
```

**Agent mode output (JSON):**

```json
{
  "reasoning": "Customer purchased 15 days ago, within refund window...",
  "action": {
    "type": "refund",
    "purchaseId": "pur_abc",
    "amount": 29900
  },
  "result": {
    "success": true,
    "refundId": "re_xyz"
  },
  "draftResponse": "Hi Joel, I've processed your refund..."
}
```

## Bulk Ops

```bash
skill refund --bulk --csv refunds.csv --dry-run
skill transfer --bulk --csv transfers.csv
```

## Observability

```bash
skill logs --app tt --since 1h
skill trace tr_xxx
skill metrics --app tt --period 7d
```

## Eval & Training Data

```bash
skill export conversations --since 2023-01-01 --app tt --format jsonl > tt.jsonl
skill enrich tt.jsonl --stripe-outcomes --resolution-time > tt_enriched.jsonl
skill sample tt_enriched.jsonl --strategy stratified --size 500 > tt_eval.jsonl

skill eval run --dataset tt_eval.jsonl --agent support-agent
skill eval report --format markdown
```

