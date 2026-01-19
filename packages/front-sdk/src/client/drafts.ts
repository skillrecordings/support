import {
  CreateDraftSchema,
  DraftListSchema,
  DraftSchema,
  EditDraftSchema,
} from '../schemas/draft'
import type { CreateDraft, Draft, DraftList, EditDraft } from '../schemas/draft'
import type { BaseClient } from './base'

/**
 * Drafts API client
 * Provides methods for creating and managing message drafts
 */
export function createDraftsClient(client: BaseClient) {
  return {
    /**
     * Create draft on channel
     * @param channelId - Channel ID to create draft on
     * @param data - Draft creation data
     */
    create: (channelId: string, data: CreateDraft) =>
      client.post<Draft>(`/channels/${channelId}/drafts`, data, DraftSchema),

    /**
     * Create draft reply on conversation
     * @param conversationId - Conversation ID to reply to
     * @param data - Draft creation data
     */
    createReply: (conversationId: string, data: CreateDraft) =>
      client.post<Draft>(
        `/conversations/${conversationId}/drafts`,
        data,
        DraftSchema
      ),

    /**
     * List drafts on conversation
     * @param conversationId - Conversation ID
     */
    list: (conversationId: string) =>
      client.get<DraftList>(
        `/conversations/${conversationId}/drafts`,
        DraftListSchema
      ),

    /**
     * Edit draft (requires version for optimistic locking)
     * @param draftId - Draft ID
     * @param data - Draft edit data (must include version)
     */
    edit: (draftId: string, data: EditDraft) =>
      client.patch<Draft>(`/drafts/${draftId}`, data, DraftSchema),

    /**
     * Delete draft
     * @param draftId - Draft ID
     */
    delete: (draftId: string) => client.delete<void>(`/drafts/${draftId}`),
  }
}
