#!/bin/bash
# UserPromptSubmit hook that matches skills based on prompt content
# Skills are auto-activated by Claude, but this enforces explicit evaluation

prompt="$CLAUDE_PROMPT"
matches=""

# Pattern matching for each skill
[[ "$prompt" =~ (tool|agent.tool|define.tool|capability|action) ]] && matches+="agent-tool "
[[ "$prompt" =~ (ai.sdk|generateText|streamText|tool\(\)|v6|multi.step|agentic) ]] && matches+="ai-sdk "
[[ "$prompt" =~ (front|webhook|inbound|conversation|message.handler) ]] && matches+="front-webhook "
[[ "$prompt" =~ (hitl|approval|slack.approval|human.in.the.loop|review.queue|approve) ]] && matches+="hitl-approval "
[[ "$prompt" =~ (inngest|workflow|step\.run|createFunction|durable|async.process) ]] && matches+="inngest-workflow "
[[ "$prompt" =~ (setup|configure|env|credentials|API.key|\.env) ]] && matches+="ops-setup "
[[ "$prompt" =~ (react|component|Next\.js|nextjs|performance|bundle|RSC|server.component) ]] && matches+="react-best-practices "
[[ "$prompt" =~ (sdk|adapter|integration|SupportIntegration|onboard.app) ]] && matches+="sdk-adapter "
[[ "$prompt" =~ (stripe|connect|oauth|refund|charge|payment|subscription) ]] && matches+="stripe-connect "
[[ "$prompt" =~ (test|tdd|vitest|red.green|failing.test|spec) ]] && matches+="tdd-red-green-refactor "
[[ "$prompt" =~ (vector|embed|semantic|rag|retrieval|knowledge|search) ]] && matches+="vector-search "
[[ "$prompt" =~ (deploy|vercel|env.var|production|domain) ]] && matches+="vercel-cli "

if [[ -n "$matches" ]]; then
  echo "SKILL MATCH DETECTED - Read these BEFORE proceeding:"
  for skill in $matches; do
    echo "  -> .claude/skills/$skill/SKILL.md"
  done
  echo ""
  echo "Use Read tool on matched skills NOW, then proceed with task."
fi
