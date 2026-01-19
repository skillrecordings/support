import { TagListSchema, TagSchema } from '../schemas/tag'
import type { Tag, TagList } from '../schemas/tag'
import type { BaseClient } from './base'

/**
 * Tags client for the Front API
 * Provides methods for managing tags
 *
 * Tags are used to categorize and organize conversations.
 * They can be private or public, and have optional highlighting.
 *
 * @see https://dev.frontapp.com/reference/tags
 */
export function createTagsClient(client: BaseClient) {
  return {
    /**
     * List all tags
     * @returns Paginated list of tags
     */
    list: () => client.get<TagList>('/tags', TagListSchema),

    /**
     * Get a specific tag by ID
     * @param id - Tag ID (e.g., "tag_123")
     * @returns Tag details
     */
    get: (id: string) => client.get<Tag>(`/tags/${id}`, TagSchema),

    /**
     * Create a new tag
     * @param data - Tag creation payload
     * @returns Created tag
     */
    create: (data: {
      name: string
      description?: string
      highlight?: string
    }) => client.post<Tag>('/tags', data, TagSchema),

    /**
     * Update an existing tag
     * @param id - Tag ID to update
     * @param data - Tag update payload
     * @returns Updated tag
     */
    update: (
      id: string,
      data: {
        name?: string
        description?: string | null
        highlight?: string | null
      }
    ) => client.patch<Tag>(`/tags/${id}`, data, TagSchema),

    /**
     * Delete a tag
     * @param id - Tag ID to delete
     * @returns void on success
     */
    delete: (id: string) => client.delete<void>(`/tags/${id}`),

    /**
     * List child tags of a parent tag
     * @param id - Parent tag ID
     * @returns Paginated list of child tags
     */
    listChildren: (id: string) =>
      client.get<TagList>(`/tags/${id}/children`, TagListSchema),

    /**
     * List conversations with this tag
     * @param id - Tag ID
     * @returns Conversations endpoint (raw response)
     */
    listConversations: (id: string) => client.get(`/tags/${id}/conversations`),
  }
}
