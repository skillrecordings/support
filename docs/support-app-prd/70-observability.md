# Observability

## Logging (Axiom)

Use `log()` for structured events. Levels map to success/error for error-rate
calculations:

- debug/info/warn: `status = "success"`, `success = true`
- error: `status = "error"`, `success = false`

Reserved fields (`name`, `type`, `status`, `success`, `level`, `message`) are
owned by the logger and should not be reused for application metadata. Prefer
`httpStatus`/`responseStatus` for HTTP codes.

## Tracing (Axiom)

```typescript
import { trace } from '@axiomhq/js'

export function withTracing<T>(
  name: string,
  fn: () => Promise<T>,
  attributes?: Record<string, string>
): Promise<T> {
  return trace(name, async (span) => {
    span.setAttributes(attributes)
    try {
      const result = await fn()
      span.setStatus({ code: 'OK' })
      return result
    } catch (error) {
      span.setStatus({ code: 'ERROR', message: error.message })
      throw error
    }
  })
}
```

## LLM Observability (Langfuse)

```typescript
import { Langfuse } from 'langfuse'

const langfuse = new Langfuse({
  publicKey: process.env.LANGFUSE_PUBLIC_KEY,
  secretKey: process.env.LANGFUSE_SECRET_KEY,
})

export async function traceAgentRun(agentRun: AgentRun, context: ConversationContext) {
  const trace = langfuse.trace({
    name: 'support-agent',
    metadata: {
      conversationId: context.conversationId,
      appId: context.appId,
      userEmail: context.userEmail,
    },
  })

  const generation = trace.generation({
    name: 'agent-reasoning',
    model: 'claude-sonnet-4-[PHONE]',
    input: agentRun.input,
    output: agentRun.output,
    usage: agentRun.usage,
  })

  return { traceId: trace.id, generationId: generation.id }
}
```
