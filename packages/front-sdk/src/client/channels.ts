import {
  type Channel,
  type ChannelList,
  ChannelListSchema,
  ChannelSchema,
  type CreateChannel,
  type UpdateChannel,
} from '../schemas/channel'
import type { BaseClient } from './base'

/**
 * Channels client for Front API
 * Manages communication channels (email, SMS, social media, etc.)
 */
export function createChannelsClient(client: BaseClient) {
  return {
    /**
     * List all channels
     * @returns Paginated list of channels
     */
    list: () => client.get<ChannelList>('/channels', ChannelListSchema),

    /**
     * Get a specific channel by ID
     * @param id - Channel ID
     * @returns Channel details
     */
    get: (id: string) => client.get<Channel>(`/channels/${id}`, ChannelSchema),

    /**
     * Update a channel
     * @param id - Channel ID
     * @param data - Update payload (name and/or settings)
     * @returns Updated channel
     */
    update: (id: string, data: UpdateChannel) =>
      client.patch<Channel>(`/channels/${id}`, data, ChannelSchema),

    /**
     * Validate a channel configuration
     * Tests channel connectivity and authentication
     * @param id - Channel ID
     */
    validate: (id: string) => client.post<void>(`/channels/${id}/validate`, {}),

    /**
     * Create a new channel
     * Channels are created within an inbox
     * @param inboxId - Inbox ID where channel will be created
     * @param data - Channel type and settings
     * @returns Created channel
     */
    create: (inboxId: string, data: CreateChannel) =>
      client.post<Channel>(`/inboxes/${inboxId}/channels`, data, ChannelSchema),
  }
}
