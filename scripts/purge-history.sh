#!/usr/bin/env bash
set -euo pipefail

if [[ "${CONFIRM_PURGE:-}" != "YES" ]]; then
  echo "Refusing to run without CONFIRM_PURGE=YES."
  echo "This script rewrites git history and is destructive."
  exit 1
fi

if [[ ! -d .git ]]; then
  echo "Run this from the repo root (missing .git)."
  exit 1
fi

if ! command -v git-filter-repo >/dev/null 2>&1; then
  echo "git-filter-repo is required. Install with: pipx install git-filter-repo"
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Working tree must be clean before running history rewrite."
  exit 1
fi

PII_JSON_PATHS=(
  docs/template-audit-data.json
  fixtures/apps/ai-hero-eval.json
  fixtures/apps/generic-eval.json
  fixtures/apps/total-typescript-eval.json
  fixtures/baselines/full-analysis.json
  fixtures/baselines/pipeline-v2-results.json
  fixtures/baselines/production-quality-baseline.json
  fixtures/customers/frustrated-customer.json
  fixtures/customers/happy-customer.json
  fixtures/customers/no-purchase.json
  fixtures/customers/recent-purchase.json
  fixtures/customers/whale-customer.json
  fixtures/datasets/auto-labeled.json
  fixtures/datasets/classify-scenarios.json
  fixtures/datasets/combined-threads.json
  fixtures/datasets/comprehensive-dataset.json
  fixtures/datasets/llm-labeled-expanded.json
  fixtures/datasets/llm-labeled.json
  fixtures/datasets/real-threads.json
  fixtures/datasets/thread-scenarios-labeled.json
  fixtures/datasets/thread-scenarios-production.json
  fixtures/datasets/thread-scenarios.json
  fixtures/datasets/validate-scenarios.json
  fixtures/fewshot/high-confidence-examples.json
  fixtures/fewshot/resolved-examples.json
  fixtures/scenarios/access/03-wrong-email.json
  fixtures/scenarios/access/04-transfer-request.json
  fixtures/scenarios/routing/03-bounce.json
  fixtures/scenarios/routing/04-auto-reply.json
  packages/cli/data/actual-support-requests.json
  packages/cli/data/aihero-archived.json
  packages/cli/data/aihero-conversations.json
  packages/cli/data/eval-dataset.json
  packages/cli/data/merged-conversations.json
  packages/cli/data/real-support-requests.json
  packages/cli/data/support-requests.json
  packages/cli/data/total-typescript-conversations.json
  packages/cli/data/tt-archive-200-labeled.json
  packages/cli/data/tt-archive-200.json
  packages/cli/data/tt-archive-eval.json
  packages/cli/data/tt-archived.json
  packages/cli/data/tt-combined-eval.json
  packages/cli/data/tt-front-conversations.json
  packages/cli/data/tt-front-eval.json
  packages/core/src/evals/testdata/current-prod.json
  ralph-gold-data/prd.json
  ralph-gold-data/reports/template-quality.json
  ralph-gold-data/reports/templates-for-review.json
  template-review/public/data/templates-for-review.json
)

FILTER_ARGS=(
  --path artifacts
)

for path in "${PII_JSON_PATHS[@]}"; do
  FILTER_ARGS+=(--path "$path")
done

FILTER_ARGS+=(--invert-paths)

REPLACE_FILE="$(mktemp)"
trap 'rm -f "$REPLACE_FILE"' EXIT
cat > "$REPLACE_FILE" <<'REPLACEMENTS'
regex:(?i)[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}==>[EMAIL]
regex:(?i)[A-Z0-9._%+-]+%40[A-Z0-9.-]+%2E[A-Z]{2,}==>[EMAIL]
regex:(?i)mailto:[A-Z0-9._%+-]+(?:%40|@)[A-Z0-9.-]+(?:%2E|\.)[A-Z]{2,}==>mailto:[EMAIL]
regex:(?i)\b(?:\+?\d{1,3}[-. ]?)?(?:\(?\d{3}\)?[-. ]?)?\d{3}[-. ]?\d{4}\b==>[PHONE]
regex:(?i)([?&](?:token|auth|access_token|id_token|refresh_token|code|client_id|client_secret)=)[A-Z0-9%._-]{10,}==>\1[REDACTED]
regex:(?i)([?&][A-Z0-9_]+)=([A-F0-9]{8}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{12})==>\1=[REDACTED]
regex:(?i)([?&][A-Z0-9_]+)=([A-F0-9]{20,})==>\1=[REDACTED]
REPLACEMENTS

git filter-repo --force \
  --replace-text "$REPLACE_FILE" \
  "${FILTER_ARGS[@]}"

echo "History rewrite complete. Review and force-push as needed."
