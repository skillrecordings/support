import { generateObject } from 'ai'
import { z } from 'zod/v4'

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
] as const

export type ClassifierCategory = (typeof CLASSIFIER_CATEGORIES)[number]

// Flat schema to avoid TS2589 with Output.object generics
// Category validation happens at runtime via Set lookup
export const ClassifierResultSchema = z.object({
  category: z.string(),
  confidence: z.number(),
  reasoning: z.string(),
})

// Runtime validation for categories
const categorySet = new Set<string>(CLASSIFIER_CATEGORIES)

export type ClassifierResult = {
  category: ClassifierCategory
  confidence: number
  reasoning: string
}

function validateCategory(raw: string): ClassifierCategory {
  if (!categorySet.has(raw)) {
    throw new Error(`Invalid category: ${raw}`)
  }
  return raw as ClassifierCategory
}

export async function classifyMessage(
  message: string,
  context?: { recentMessages?: string[] }
): Promise<ClassifierResult> {
  // Build prompt with category guidance and optional conversation context
  let prompt = `Classify this customer support message into one of the predefined categories:

- needs_response: Requires agent reply
- no_response: Automated/spam messages
- canned_response: Can use template response
- human_required: Complex or sensitive issues
- refund: Refund request
- transfer: License transfer request
- account_issue: Login or access problems
- billing: Invoice or charge inquiries
- technical: Product functionality issues
- general: Other inquiries

Message: ${message}`

  if (context?.recentMessages && context.recentMessages.length > 0) {
    const conversationContext = context.recentMessages.join('\n')
    prompt += `\n\nRecent conversation context:\n${conversationContext}`
  }

  prompt += `\n\nProvide:
1. category: One of the categories above
2. confidence: Score 0-1 (>0.9 for clear cases, 0.7-0.9 for likely, <0.7 for uncertain)
3. reasoning: Brief explanation (1-2 sentences) of why this category was chosen`

  const result = await generateObject({
    model: 'anthropic/claude-haiku-4-5',
    prompt,
    schema: ClassifierResultSchema,
  })

  return {
    category: validateCategory(result.object.category),
    confidence: result.object.confidence,
    reasoning: result.object.reasoning,
  }
}
