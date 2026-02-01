/**
 * Comment Context Service
 *
 * Fetches and structures conversation message threads from Front,
 * providing a unified view of all messages with author information.
 */

import {
  type Author,
  type Message,
  type MessageList,
  paginate,
} from '@skillrecordings/front-sdk'
import { createInstrumentedFrontClient } from '../front/instrumented-client'

/**
 * Simplified author info for the thread context
 */
export interface ThreadAuthor {
  id: string
  email: string
  name: string | null
  isTeammate: boolean
}

/**
 * Message in the comment thread with essential fields
 */
export interface ThreadMessage {
  id: string
  body: string
  text: string | null
  isInbound: boolean
  createdAt: number
  authorId: string | null
  authorEmail: string | null
}

/**
 * Complete comment thread with messages and author context
 */
export interface CommentThread {
  /** All messages in the thread, ordered by creation time (oldest first) */
  messages: ThreadMessage[]
  /** Map of author IDs to author info (teammates who authored outbound messages) */
  authors: Map<string, ThreadAuthor>
  /** Timestamp of the most recent message */
  latestTimestamp: number
  /** Total number of messages in the thread */
  messageCount: number
}

/**
 * Configuration for the comment context service
 */
export interface CommentContextConfig {
  /** Front API token */
  apiToken: string
}

/**
 * Extract author email from message recipients (for inbound messages)
 */
function extractSenderEmail(message: Message): string | null {
  const from = message.recipients.find((r) => r.role === 'from')
  return from?.handle ?? null
}

/**
 * Transform a Front Message to our ThreadMessage format
 */
function toThreadMessage(message: Message): ThreadMessage {
  const authorEmail = message.author?.email ?? extractSenderEmail(message)

  return {
    id: message.id,
    body: message.body,
    text: message.text,
    isInbound: message.is_inbound,
    createdAt: message.created_at,
    authorId: message.author?.id ?? null,
    authorEmail,
  }
}

/**
 * Build author from Front API Author
 */
function toThreadAuthor(author: Author): ThreadAuthor {
  const name =
    [author.first_name, author.last_name].filter(Boolean).join(' ') || null

  return {
    id: author.id,
    email: author.email,
    name,
    isTeammate: true,
  }
}

/**
 * Create a comment context service for fetching conversation threads
 *
 * @example
 * ```ts
 * const service = createCommentContextService({ apiToken: 'xxx' })
 * const thread = await service.getCommentThread('cnv_abc123')
 *
 * console.log(`${thread.messageCount} messages, latest at ${thread.latestTimestamp}`)
 * for (const msg of thread.messages) {
 *   const author = msg.authorId ? thread.authors.get(msg.authorId) : null
 *   console.log(`[${author?.name ?? msg.authorEmail}]: ${msg.text}`)
 * }
 * ```
 */
export function createCommentContextService(config: CommentContextConfig) {
  const front = createInstrumentedFrontClient({ apiToken: config.apiToken })

  return {
    /**
     * Fetch the complete message thread for a conversation
     *
     * Handles pagination automatically to fetch all messages,
     * and builds a unified author map from teammate authors.
     *
     * @param conversationId - Front conversation ID (cnv_xxx)
     * @returns Complete thread with messages, authors, and metadata
     */
    async getCommentThread(conversationId: string): Promise<CommentThread> {
      // Fetch all messages with automatic pagination
      const allMessages = await paginate<MessageList>(
        () =>
          front.conversations.listMessages(
            conversationId
          ) as Promise<MessageList>,
        (url) => front.raw.get<MessageList>(url)
      )

      // Sort by creation time (oldest first for conversation flow)
      const sortedMessages = (allMessages as Message[]).sort(
        (a, b) => a.created_at - b.created_at
      )

      // Build author map from teammate authors
      const authors = new Map<string, ThreadAuthor>()
      for (const message of sortedMessages) {
        if (message.author && !authors.has(message.author.id)) {
          authors.set(message.author.id, toThreadAuthor(message.author))
        }
      }

      // Transform messages
      const messages = sortedMessages.map(toThreadMessage)

      // Calculate latest timestamp
      const lastMessage = sortedMessages[sortedMessages.length - 1]
      const latestTimestamp = lastMessage?.created_at ?? 0

      return {
        messages,
        authors,
        latestTimestamp,
        messageCount: messages.length,
      }
    },
  }
}

export type CommentContextService = ReturnType<
  typeof createCommentContextService
>
