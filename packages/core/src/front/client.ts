/**
 * Front API client for fetching conversation and message data.
 *
 * @deprecated Use `@skillrecordings/front-sdk` directly for new code.
 * This module re-exports the SDK for backward compatibility.
 *
 * Migration:
 * ```ts
 * // Old
 * import { createFrontClient } from '@skillrecordings/core/front'
 * const client = createFrontClient(token)
 *
 * // New
 * import { createFrontClient } from '@skillrecordings/front-sdk'
 * const client = createFrontClient({ apiToken: token })
 * ```
 */

import {
  type Channel,
  type ChannelList,
  type Conversation,
  type Draft,
  type Inbox,
  type InboxList,
  type Message,
  type MessageList,
  createFrontClient as createSdkClient,
} from '@skillrecordings/front-sdk'
import { marked } from 'marked'

// Configure marked for email-safe output
marked.setOptions({
  gfm: true,
  breaks: true,
})

/**
 * Convert markdown to HTML for Front email drafts.
 */
function markdownToHtml(text: string): string {
  return marked.parse(text) as string
}

/**
 * Extract the best customer email from a Front message.
 *
 * For inbound messages (e.g., feedback forms), the actual customer email is
 * often in the `reply-to` role, not `from`. This function prioritizes `reply-to`
 * and falls back to `from` if not present.
 *
 * @param message - The Front message to extract email from
 * @returns The customer's email address, or null if not found
 *
 * @example
 * ```ts
 * const email = extractCustomerEmail(message)
 * // Returns "[EMAIL]" from reply-to or from recipient
 * ```
 */
export function extractCustomerEmail(message: FrontMessage): string | null {
  const recipients = message.recipients || []

  // 1. Prefer reply-to (actual customer for feedback forms)
  const replyTo = recipients.find((r) => r.role === 'reply-to')
  if (replyTo?.handle) return replyTo.handle

  // 2. Fall back to from
  const from = recipients.find((r) => r.role === 'from')
  return from?.handle || null
}

// ============================================================================
// Backward-compatible types (re-export from SDK)
// ============================================================================

/** @deprecated Use `Message` from `@skillrecordings/front-sdk` */
export type FrontMessage = Message

/** @deprecated Use `Conversation` from `@skillrecordings/front-sdk` */
export type FrontConversation = Conversation

/** @deprecated Use `Inbox` from `@skillrecordings/front-sdk` */
export type FrontInbox = Inbox

/** @deprecated Use `InboxList` from `@skillrecordings/front-sdk` */
export type FrontInboxes = InboxList

/** @deprecated Use `Channel` from `@skillrecordings/front-sdk` */
export type FrontChannel = Channel

/** @deprecated Use `ChannelList` from `@skillrecordings/front-sdk` */
export type FrontChannels = ChannelList

/** @deprecated Use `MessageList` from `@skillrecordings/front-sdk` */
export type FrontConversationMessages = MessageList

// ============================================================================
// Backward-compatible client
// ============================================================================

/**
 * Create a Front API client with the given token.
 *
 * @deprecated Use `createFrontClient` from `@skillrecordings/front-sdk` instead.
 * This wrapper maintains backward compatibility with the old API.
 */
export function createFrontClient(apiToken: string) {
  const sdk = createSdkClient({ apiToken })

  return {
    /**
     * Get a single message by ID or URL
     */
    async getMessage(messageIdOrUrl: string): Promise<FrontMessage> {
      const id = messageIdOrUrl.startsWith('http')
        ? messageIdOrUrl.split('/').pop()!
        : messageIdOrUrl
      return sdk.messages.get(id)
    },

    /**
     * Get a conversation by ID or URL
     */
    async getConversation(
      conversationIdOrUrl: string
    ): Promise<FrontConversation> {
      const id = conversationIdOrUrl.startsWith('http')
        ? conversationIdOrUrl.split('/').pop()!
        : conversationIdOrUrl
      return sdk.conversations.get(id) as unknown as FrontConversation
    },

    /**
     * Get all messages in a conversation
     */
    async getConversationMessages(
      conversationId: string
    ): Promise<FrontMessage[]> {
      const data = await sdk.conversations.listMessages(conversationId)
      return (data as MessageList)._results
    },

    /**
     * Get the inboxes associated with a conversation
     * Returns the first inbox ID (conversations typically have one inbox)
     */
    async getConversationInbox(conversationId: string): Promise<string | null> {
      const data = await sdk.raw.get<InboxList>(
        `/conversations/${conversationId}/inboxes`
      )
      return data._results[0]?.id ?? null
    },

    /**
     * Get channels for an inbox
     * Returns the first channel ID (used for creating drafts)
     */
    async getInboxChannel(inboxId: string): Promise<string | null> {
      const data = await sdk.raw.get<ChannelList>(
        `/inboxes/${inboxId}/channels`
      )
      return data._results[0]?.id ?? null
    },

    /**
     * Create a draft reply in a conversation
     */
    async createDraft(
      conversationId: string,
      body: string,
      channelId: string,
      options?: { authorId?: string; signatureId?: string }
    ): Promise<{ id: string }> {
      const htmlBody = markdownToHtml(body)

      const draft = await sdk.drafts.createReply(conversationId, {
        body: htmlBody,
        channel_id: channelId,
        author_id: options?.authorId,
        signature_id: options?.signatureId,
        mode: 'shared',
      })

      return { id: draft.id }
    },

    /**
     * Send a reply to a conversation (immediately, no draft)
     */
    async sendReply(
      conversationId: string,
      body: string,
      options?: { authorId?: string }
    ): Promise<{ id: string }> {
      const response = await sdk.raw.post<{ id: string }>(
        `/conversations/${conversationId}/messages`,
        {
          body,
          author_id: options?.authorId,
        }
      )
      return response
    },

    /**
     * Add an internal comment to a conversation (visible to team only)
     * Used for agent context notes, lookup results, etc.
     */
    async addComment(
      conversationId: string,
      body: string,
      authorId?: string
    ): Promise<void> {
      await sdk.conversations.addComment(conversationId, body, authorId)
    },
  }
}

export type FrontClient = ReturnType<typeof createFrontClient>
