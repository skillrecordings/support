# Phase 3 - Eval CLI Commands

## Goal

CLI commands to run evals, compare prompts, and report quality metrics.

## Deliverables

- `skill eval-local run` - Run full eval suite
- `skill eval-local compare` - Compare prompt A vs B
- `skill eval-local scenario` - Run single scenario
- `skill eval-local report` - Generate detailed report

## Command Reference

### Run Full Suite

```bash
skill eval-local run [options]

Options:
  --scenarios <glob>     Scenario files (default: fixtures/scenarios/**/*.json)
  --output <file>        Save results to JSON file
  --baseline <file>      Compare against baseline results
  --fail-threshold <n>   Fail if pass rate below threshold (default: 0.8)
  --verbose              Show individual scenario results
  --json                 JSON output for scripting

Examples:
  skill eval-local run
  skill eval-local run --scenarios "fixtures/scenarios/refund/*.json"
  skill eval-local run --baseline results/v1.2.3.json --fail-threshold 0.85
```

### Compare Prompts

```bash
skill eval-local compare [options]

Options:
  --candidate <file>     Candidate prompt file (required)
  --baseline <file>      Baseline prompt file (default: production)
  --scenarios <glob>     Scenario files
  --output <file>        Save comparison to JSON
  --json                 JSON output

Examples:
  skill eval-local compare --candidate prompts/v2.md
  skill eval-local compare --candidate prompts/v2.md --baseline prompts/v1.md
```

### Run Single Scenario

```bash
skill eval-local scenario <file> [options]

Options:
  --prompt <file>        Use custom prompt
  --verbose              Show full agent output + tool calls
  --trace                Enable detailed tracing

Examples:
  skill eval-local scenario fixtures/scenarios/refund/within-policy.json
  skill eval-local scenario fixtures/scenarios/routing/fan-mail.json --verbose
```

### Generate Report

```bash
skill eval-local report <results-file> [options]

Options:
  --format <type>        Output format: text, html, markdown (default: text)
  --output <file>        Save report to file
  --include-failures     Include full details for failures

Examples:
  skill eval-local report results/2025-01-24.json
  skill eval-local report results/2025-01-24.json --format markdown --output EVAL-REPORT.md
```

## Implementation

### Core Runner

```typescript
// packages/cli/src/commands/eval-local/run.ts

interface EvalRunOptions {
  scenarios?: string
  output?: string
  baseline?: string
  failThreshold?: number
  verbose?: boolean
  json?: boolean
}

export async function runEvalSuite(options: EvalRunOptions): Promise<void> {
  // 1. Verify environment
  await verifyLocalEnvironment()
  
  // 2. Load scenarios
  const scenarioFiles = await glob(options.scenarios || 'fixtures/scenarios/**/*.json')
  const scenarios = await Promise.all(scenarioFiles.map(loadScenario))
  
  console.log(`\n🧪 Running ${scenarios.length} scenarios\n`)
  
  // 3. Run each scenario
  const results: ScenarioResult[] = []
  for (const scenario of scenarios) {
    const result = await runScenario(scenario)
    results.push(result)
    
    if (options.verbose) {
      printScenarioResult(result)
    } else {
      process.stdout.write(result.passed ? '.' : 'F')
    }
  }
  
  // 4. Aggregate results
  const summary = aggregateResults(results)
  
  // 5. Compare to baseline if provided
  if (options.baseline) {
    const baselineResults = await loadResults(options.baseline)
    const comparison = compareResults(summary, baselineResults)
    printComparison(comparison)
  }
  
  // 6. Output
  if (options.output) {
    await writeResults(options.output, { summary, results })
  }
  
  printSummary(summary)
  
  // 7. Exit code
  const passRate = summary.passed / summary.total
  if (passRate < (options.failThreshold || 0.8)) {
    process.exit(1)
  }
}
```

### Scenario Runner

```typescript
// packages/cli/src/commands/eval-local/scenario-runner.ts

interface ScenarioResult {
  id: string
  name: string
  passed: boolean
  
  // Input
  trigger: { subject: string; body: string }
  context: { customer?: Customer; conversation?: Conversation }
  
  // Output
  output: string
  toolCalls: ToolCall[]
  durationMs: number
  
  // Quality scores
  scores: {
    internalLeaks: { passed: boolean; matches: string[] }
    metaCommentary: { passed: boolean; matches: string[] }
    bannedPhrases: { passed: boolean; matches: string[] }
    helpfulness: { score: number }
  }
  
  // Expected vs actual
  expectedBehavior: string
  actualBehavior: string
  behaviorMatch: boolean
}

async function runScenario(scenario: Scenario): Promise<ScenarioResult> {
  const startTime = Date.now()
  
  // 1. Set up context (customer, conversation history)
  const context = await setupContext(scenario.context)
  
  // 2. Run agent with full pipeline
  const agentResult = await runSupportAgent({
    message: `Subject: ${scenario.trigger.subject}\n\n${scenario.trigger.body}`,
    conversationHistory: context.conversationHistory,
    customerContext: context.customer,
    appId: scenario.appId,
    // Uses real DB, real vector search, real LLM
  })
  
  const durationMs = Date.now() - startTime
  
  // 3. Extract response
  const draftCall = agentResult.toolCalls.find(tc => tc.name === 'draftResponse')
  const output = draftCall?.args.body || ''
  
  // 4. Run quality scorers
  const scores = scoreResponse(output)
  
  // 5. Check expected behavior
  const actualBehavior = determineBehavior(agentResult)
  const behaviorMatch = actualBehavior === scenario.expectedBehavior
  
  return {
    id: scenario.id,
    name: scenario.name,
    passed: scores.passed && behaviorMatch,
    trigger: scenario.trigger,
    context: scenario.context,
    output,
    toolCalls: agentResult.toolCalls,
    durationMs,
    scores,
    expectedBehavior: scenario.expectedBehavior,
    actualBehavior,
    behaviorMatch,
  }
}
```

### Quality Scorers Integration

```typescript
// Reuses existing scorers from response-quality.eval.ts

import {
  InternalStateLeakage,
  MetaCommentary,
  BannedPhrases,
  ProductFabrication,
  Helpfulness,
} from '@skillrecordings/core/evals/response-quality'

function scoreResponse(output: string): QualityScores {
  const leakResult = InternalStateLeakage({ output })
  const metaResult = MetaCommentary({ output })
  const bannedResult = BannedPhrases({ output })
  const helpResult = Helpfulness({ output })
  
  return {
    internalLeaks: {
      passed: leakResult.score === 1,
      matches: leakResult.metadata.foundLeaks,
    },
    metaCommentary: {
      passed: metaResult.score === 1,
      matches: metaResult.metadata.foundMeta,
    },
    bannedPhrases: {
      passed: bannedResult.score === 1,
      matches: bannedResult.metadata.foundBanned,
    },
    helpfulness: {
      score: helpResult.score,
    },
    passed: leakResult.score === 1 && metaResult.score === 1 && bannedResult.score === 1,
  }
}
```

## Output Format

### Summary (Default)

```
🧪 Eval Results

Scenarios: 45 total
  ✅ Passed:  38 (84.4%)
  ❌ Failed:   7 (15.6%)

Quality Breakdown:
  🚨 Internal leaks:    3 failures
  💬 Meta-commentary:   2 failures  
  🚫 Banned phrases:    1 failure
  🎯 Behavior mismatch: 1 failure

Latency:
  p50: 1,234ms
  p95: 3,456ms
  p99: 5,678ms

Pass rate: 84.4% (threshold: 80.0%) ✅
```

### Comparison Output

```
🔬 Prompt Comparison

                    Baseline    Candidate    Delta
Pass rate:          84.4%       91.1%        +6.7% ⬆️
Internal leaks:     3           1            -2    ⬆️
Meta-commentary:    2           0            -2    ⬆️
Banned phrases:     1           1             0    ➡️
Behavior match:     41/45       43/45        +2    ⬆️

Improved scenarios:
  - refund/edge-case-45-days
  - routing/fan-mail-matt
  - technical/generics-question

Regressed scenarios:
  (none)

Verdict: CANDIDATE IS BETTER ✅
```

## PR-Ready Checklist

- [ ] `skill eval-local run` implemented
- [ ] `skill eval-local compare` implemented
- [ ] `skill eval-local scenario` implemented
- [ ] `skill eval-local report` implemented
- [ ] Quality scorers integrated
- [ ] Summary output format finalized
- [ ] Comparison output format finalized
- [ ] Exit codes correct (0 pass, 1 fail)
- [ ] JSON output works for all commands
