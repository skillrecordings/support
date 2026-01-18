import { z } from 'zod'
import { createTool } from './create-tool'

/**
 * Schema for conversation context parameters
 */
const getConversationContextParams = z.object({
  conversationId: z.string().describe('Front conversation ID'),
  includeMetadata: z
    .boolean()
    .optional()
    .default(true)
    .describe('Include metadata like tags, custom fields, and status'),
})

/**
 * Conversation message structure
 */
export interface ConversationMessage {
  id: string
  author: {
    type: 'teammate' | 'customer'
    id: string
    name?: string
    email?: string
  }
  body: string
  createdAt: Date
  isInbound: boolean
}

/**
 * Conversation context result
 */
export interface ConversationContext {
  id: string
  subject: string
  status: 'archived' | 'deleted' | 'open' | 'spam'
  messages: ConversationMessage[]
  metadata?: {
    tags?: string[]
    customFields?: Record<string, unknown>
    assignee?: {
      id: string
      name: string
      email: string
    }
  }
}

/**
 * Retrieve conversation history and context from Front.
 *
 * Fetches the complete conversation thread including all messages,
 * participants, and optional metadata like tags and custom fields.
 *
 * @example
 * ```typescript
 * const context = await getConversationContext.execute(
 *   { conversationId: 'cnv_123', includeMetadata: true },
 *   executionContext
 * )
 * ```
 */
export const getConversationContext = createTool({
  name: 'get_conversation_context',
  description:
    'Retrieve conversation history and context from Front including all messages in the thread',
  parameters: getConversationContextParams,
  execute: async (params, context): Promise<ConversationContext> => {
    // TODO: Implement Front API integration
    // 1. Use Front API client to fetch conversation by ID
    // 2. Retrieve all messages in the conversation thread
    // 3. If includeMetadata is true, fetch tags, custom fields, and assignee
    // 4. Transform Front API response to ConversationContext format
    //
    // Example API calls needed:
    // - GET /conversations/:id
    // - GET /conversations/:id/messages
    // - GET /conversations/:id/inboxes (if needed)

    throw new Error('Front API integration not yet implemented')
  },
})
