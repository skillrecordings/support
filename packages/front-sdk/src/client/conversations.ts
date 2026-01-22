import {
  type Conversation,
  type ConversationList,
  ConversationListSchema,
  ConversationSchema,
  type UpdateConversation,
  UpdateConversationSchema,
} from '../schemas/conversation'
import type { BaseClient } from './base'

/**
 * Create a conversations client for managing Front conversations
 * Provides methods for fetching, updating, and managing conversation resources
 */
export function createConversationsClient(client: BaseClient) {
  return {
    /**
     * Get a single conversation by ID
     * @param id - Conversation ID (cnv_xxx)
     */
    get: (id: string) =>
      client.get<Conversation>(`/conversations/${id}`, ConversationSchema),

    /**
     * List all conversations
     * Returns paginated results
     */
    list: () =>
      client.get<ConversationList>('/conversations', ConversationListSchema),

    /**
     * Search conversations by query
     * @param query - Search query string
     */
    search: (query: string) =>
      client.get<ConversationList>(
        `/conversations/search/${encodeURIComponent(query)}`,
        ConversationListSchema
      ),

    /**
     * Update a conversation
     * @param id - Conversation ID (cnv_xxx)
     * @param data - Update payload (assignee, status, tags, etc.)
     */
    update: (id: string, data: UpdateConversation) =>
      client.patch<Conversation>(
        `/conversations/${id}`,
        data,
        ConversationSchema
      ),

    /**
     * Update conversation assignee
     * @param id - Conversation ID (cnv_xxx)
     * @param assigneeId - Teammate ID (tea_xxx)
     * @see https://dev.frontapp.com/reference/update-conversation-assignee
     */
    updateAssignee: (id: string, assigneeId: string) =>
      client.put<void>(`/conversations/${id}/assignee`, {
        assignee_id: assigneeId,
      }),

    /**
     * List messages in a conversation
     * @param id - Conversation ID (cnv_xxx)
     */
    listMessages: (id: string) => client.get(`/conversations/${id}/messages`),

    /**
     * List comments in a conversation
     * @param id - Conversation ID (cnv_xxx)
     */
    listComments: (id: string) => client.get(`/conversations/${id}/comments`),

    /**
     * Add a comment to a conversation
     * @param id - Conversation ID (cnv_xxx)
     * @param body - Comment body (markdown supported)
     * @param authorId - Optional author teammate ID
     */
    addComment: (id: string, body: string, authorId?: string) =>
      client.post(`/conversations/${id}/comments`, {
        body,
        author_id: authorId,
      }),

    /**
     * Add a tag to a conversation
     * @param id - Conversation ID (cnv_xxx)
     * @param tagId - Tag ID (tag_xxx)
     */
    addTag: (id: string, tagId: string) =>
      client.post<void>(`/conversations/${id}/tags`, {
        tag_ids: [tagId],
      }),

    /**
     * Remove a tag from a conversation
     * @param id - Conversation ID (cnv_xxx)
     * @param tagId - Tag ID (tag_xxx)
     */
    removeTag: (id: string, tagId: string) =>
      client.delete<void>(`/conversations/${id}/tags/${tagId}`),
  }
}
