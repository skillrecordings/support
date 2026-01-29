import { InboxListSchema, InboxSchema } from '../schemas/inbox'
import type { CreateInbox, Inbox, InboxList } from '../schemas/inbox'
import type { BaseClient } from './base'

/**
 * Client for Front Inboxes API
 * @see https://dev.frontapp.com/reference/inboxes
 */
export function createInboxesClient(client: BaseClient) {
  return {
    /**
     * List all inboxes
     * @see https://dev.frontapp.com/reference/list-inboxes
     */
    list: () => client.get<InboxList>('/inboxes', InboxListSchema),

    /**
     * Get inbox by ID
     * @see https://dev.frontapp.com/reference/get-inbox
     */
    get: (id: string) => client.get<Inbox>(`/inboxes/${id}`, InboxSchema),

    /**
     * Create a new inbox
     * @see https://dev.frontapp.com/reference/create-inbox
     */
    create: (data: CreateInbox) =>
      client.post<Inbox>('/inboxes', data, InboxSchema),

    /**
     * List channels for an inbox
     * @see https://dev.frontapp.com/reference/list-inbox-channels
     */
    listChannels: (id: string) => client.get(`/inboxes/${id}/channels`),

    /**
     * List conversations for an inbox
     * @see https://dev.frontapp.com/reference/list-inbox-conversations
     */
    listConversations: (
      id: string,
      params?: { q?: string; limit?: number }
    ) => {
      const searchParams = new URLSearchParams()
      if (params?.q) searchParams.set('q', params.q)
      if (params?.limit) searchParams.set('limit', String(params.limit))
      const query = searchParams.toString()
      return client.get(
        `/inboxes/${id}/conversations${query ? `?${query}` : ''}`
      )
    },

    /**
     * List teammates for an inbox
     * @see https://dev.frontapp.com/reference/list-inbox-teammates
     */
    listTeammates: (id: string) => client.get(`/inboxes/${id}/teammates`),

    /**
     * Add teammates to an inbox
     * @see https://dev.frontapp.com/reference/add-inbox-teammates
     */
    addTeammate: (id: string, teammateId: string) =>
      client.post<void>(`/inboxes/${id}/teammates`, {
        teammate_ids: [teammateId],
      }),

    /**
     * Remove teammate from an inbox
     * @see https://dev.frontapp.com/reference/remove-inbox-teammates
     */
    removeTeammate: (id: string, teammateId: string) =>
      client.delete<void>(`/inboxes/${id}/teammates/${teammateId}`),
  }
}

export type InboxesClient = ReturnType<typeof createInboxesClient>
