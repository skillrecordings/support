import { generateObject } from 'ai'
import { z } from 'zod'
import { telemetryConfig } from '../observability/otel'

// Valid categories for classification
export const CLASSIFIER_CATEGORIES = [
  'needs_response',
  'no_response',
  'canned_response',
  'human_required',
  'refund',
  'transfer',
  'account_issue',
  'billing',
  'technical',
  'general',
  'instructor_correspondence',
  'team_correspondence',
] as const

/**
 * Structured thread message for classifier context
 */
export type ThreadMessage = {
  sender: string // email address
  isInbound: boolean
  body: string
}

export type ClassifierCategory = (typeof CLASSIFIER_CATEGORIES)[number]

// Complexity tiers for model selection
export const COMPLEXITY_TIERS = ['skip', 'simple', 'complex'] as const
export type ComplexityTier = (typeof COMPLEXITY_TIERS)[number]

// Flat schema to avoid TS2589 with Output.object generics
// Category validation happens at runtime via Set lookup
export const ClassifierResultSchema = z.object({
  category: z.string(),
  confidence: z.number(),
  reasoning: z.string(),
  complexity: z.string(), // skip, simple, complex
})

// Runtime validation for categories
const categorySet = new Set<string>(CLASSIFIER_CATEGORIES)
const complexitySet = new Set<string>(COMPLEXITY_TIERS)

export type ClassifierResult = {
  category: ClassifierCategory
  confidence: number
  reasoning: string
  complexity: ComplexityTier
  usage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
}

function validateCategory(raw: string): ClassifierCategory {
  if (!categorySet.has(raw)) {
    throw new Error(`Invalid category: ${raw}`)
  }
  return raw as ClassifierCategory
}

function validateComplexity(raw: string): ComplexityTier {
  if (!complexitySet.has(raw)) {
    // Default to complex if unknown
    return 'complex'
  }
  return raw as ComplexityTier
}

export async function classifyMessage(
  message: string,
  context?: {
    recentMessages?: string[] // deprecated: use threadMessages instead
    threadMessages?: ThreadMessage[]
    senderEmail?: string
    priorKnowledge?: string
  }
): Promise<ClassifierResult> {
  // Build prompt with category guidance and optional conversation context
  let prompt = `Classify this customer support message.

## Categories
- needs_response: Requires agent reply
- no_response: Automated/spam messages, acknowledgments (thanks, got it)
- canned_response: Can use template response
- human_required: Complex or sensitive issues
- refund: Refund request
- transfer: License transfer request
- account_issue: Login or access problems
- billing: Invoice or charge inquiries
- technical: Product functionality issues
- general: Other inquiries
- instructor_correspondence: Personal fan mail from CUSTOMERS to the instructor (compliments, appreciation, feedback about teaching style, personal questions). NOT business discussions.
- team_correspondence: Business discussions between team members, partners, or internal stakeholders about product strategy, operations, launches, cohorts, scheduling. NOT customer support. Route to human without AI response.

## Complexity (for model selection)
- skip: Don't respond (spam, acks, bounces, auto-replies, team correspondence)
- simple: Easy to answer (FAQ, magic link, basic info), instructor correspondence - fast model OK
- complex: Nuanced issue, frustrated customer, needs reasoning - use powerful model

## Sender context
${context?.senderEmail ? `Current message from: ${context.senderEmail}` : 'Sender unknown'}

Message: ${message}`

  // Prefer structured thread messages over legacy string array
  if (context?.threadMessages && context.threadMessages.length > 0) {
    const threadContext = context.threadMessages
      .map((m) => {
        const direction = m.isInbound ? '→' : '←'
        const preview =
          m.body.length > 300 ? m.body.slice(0, 300) + '...' : m.body
        return `[${m.sender}] ${direction}\n${preview}`
      })
      .join('\n\n')
    prompt += `\n\n## Thread history (oldest first)\n${threadContext}`
  } else if (context?.recentMessages && context.recentMessages.length > 0) {
    // Legacy fallback
    const conversationContext = context.recentMessages.join('\n---\n')
    prompt += `\n\nRecent conversation context:\n${conversationContext}`
  }

  if (context?.priorKnowledge && context.priorKnowledge.trim().length > 0) {
    prompt += `\n\nPrior knowledge from memory:\n${context.priorKnowledge}`
  }

  prompt += `\n\nProvide:
1. category: One of the categories above
2. complexity: skip, simple, or complex
3. confidence: Score 0-1 (>0.9 for clear cases, 0.7-0.9 for likely, <0.7 for uncertain)
4. reasoning: Brief explanation (1-2 sentences)`

  const result = await generateObject({
    model: 'anthropic/claude-haiku-4-5',
    prompt,
    schema: ClassifierResultSchema,
    experimental_telemetry: telemetryConfig,
  })

  // AI SDK v6 usage type - extract token counts safely
  const usage = result.usage as
    | { promptTokens?: number; completionTokens?: number; totalTokens?: number }
    | undefined

  return {
    category: validateCategory(result.object.category),
    confidence: result.object.confidence,
    reasoning: result.object.reasoning,
    complexity: validateComplexity(result.object.complexity),
    usage:
      usage?.promptTokens !== undefined
        ? {
            promptTokens: usage.promptTokens,
            completionTokens: usage.completionTokens ?? 0,
            totalTokens: usage.totalTokens ?? usage.promptTokens,
          }
        : undefined,
  }
}
