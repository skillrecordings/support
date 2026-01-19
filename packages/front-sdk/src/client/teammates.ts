import {
  type Teammate,
  type TeammateList,
  TeammateListSchema,
  TeammateSchema,
  type UpdateTeammate,
} from '../schemas/teammate'
import type { BaseClient } from './base'

/**
 * Create a teammates client for Front API
 * Provides methods to manage teammates (users) in the workspace
 */
export function createTeammatesClient(client: BaseClient) {
  return {
    /**
     * List all teammates
     * @returns Paginated list of teammates
     */
    list: () => client.get<TeammateList>('/teammates', TeammateListSchema),

    /**
     * Get a teammate by ID
     * @param id - Teammate ID (e.g., "tea_abc123")
     * @returns Teammate details
     */
    get: (id: string) =>
      client.get<Teammate>(`/teammates/${id}`, TeammateSchema),

    /**
     * Update a teammate
     * @param id - Teammate ID
     * @param data - Partial teammate data to update
     * @returns Updated teammate
     */
    update: (id: string, data: UpdateTeammate) =>
      client.patch<Teammate>(`/teammates/${id}`, data, TeammateSchema),

    /**
     * List conversations assigned to a teammate
     * @param id - Teammate ID
     * @returns Paginated list of conversations (untyped - use conversations client for typed response)
     */
    listConversations: (id: string) =>
      client.get(`/teammates/${id}/conversations`),

    /**
     * List inboxes accessible to a teammate
     * @param id - Teammate ID
     * @returns Paginated list of inboxes (untyped - use inboxes client for typed response)
     */
    listInboxes: (id: string) => client.get(`/teammates/${id}/inboxes`),
  }
}
