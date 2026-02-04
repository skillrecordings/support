import { generateObject } from 'ai'
import { z } from 'zod'
import type { ParsedIntent } from './types'

const IntentSchema = z.object({
  category: z.enum([
    'status_query',
    'context_lookup',
    'escalation',
    'draft_action',
    'general_query',
  ]),
  confidence: z.number().min(0).max(1),
  entities: z.object({
    email: z.string().optional(),
    name: z.string().optional(),
    query: z.string().optional(),
    product: z.string().optional(),
  }),
  reasoning: z.string(),
})

type IntentSchemaOutput = z.infer<typeof IntentSchema>

function normalizeEntities(entities: IntentSchemaOutput['entities']) {
  return Object.fromEntries(
    Object.entries(entities).filter(([, value]) => value !== undefined)
  ) as Record<string, string>
}

export async function classifyIntent(rawText: string): Promise<ParsedIntent> {
  const { object } = await generateObject({
    model: 'anthropic/claude-haiku-4-5',
    schema: IntentSchema,
    prompt: `You are a support team Slack bot intent classifier.

Classify this message from a team member:
"${rawText}"

Categories:
- status_query: asking about pending/urgent/open conversations
- context_lookup: looking up a specific customer or conversation (by email, name, product)
- escalation: wants to escalate something to a teammate
- draft_action: feedback on a draft response (approve, rewrite, shorten)
- general_query: any other support-related question that could be answered by searching conversations

Extract any entities: email addresses, person names, search queries, product names.
Skill Recordings products include: AI Hero, Total TypeScript, Pro Tailwind, Epic Web, Testing JavaScript, React for TypeScript.`,
  })

  return {
    category: object.category,
    confidence: object.confidence,
    entities: normalizeEntities(object.entities),
    rawText,
  }
}
