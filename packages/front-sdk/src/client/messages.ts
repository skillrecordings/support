import { MessageListSchema, MessageSchema } from '../schemas/message'
import type { CreateMessage, Message, MessageList } from '../schemas/message'
import type { BaseClient } from './base'

/**
 * Create a messages client for Front API operations
 * Provides methods for fetching, creating, and managing messages
 */
export function createMessagesClient(client: BaseClient) {
  return {
    /**
     * Get a single message by ID
     * @param id - Message ID (msg_xxx)
     */
    get: (id: string) => client.get<Message>(`/messages/${id}`, MessageSchema),

    /**
     * Mark a message as seen
     * @param id - Message ID (msg_xxx)
     */
    markSeen: (id: string) => client.post<void>(`/messages/${id}/seen`, {}),

    /**
     * Get the seen status of a message
     * @param id - Message ID (msg_xxx)
     */
    getSeenStatus: (id: string) => client.get(`/messages/${id}/seen`),

    /**
     * Create a new message via a channel
     * @param channelId - Channel ID (cha_xxx)
     * @param data - Message data (to, body, subject, etc.)
     */
    create: (channelId: string, data: CreateMessage) =>
      client.post<Message>(
        `/channels/${channelId}/messages`,
        data,
        MessageSchema
      ),
  }
}

/**
 * Type for the messages client instance
 */
export type MessagesClient = ReturnType<typeof createMessagesClient>
