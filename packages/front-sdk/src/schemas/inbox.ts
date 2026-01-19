import { z } from 'zod'
import { PaginatedResponseSchema } from './common'

/**
 * Inbox schema for Front API responses
 * Represents a Front inbox with teammates, conversations, and channels
 */
export const InboxSchema = z.object({
  _links: z.object({
    self: z.string().url(),
    related: z.object({
      teammates: z.string().url(),
      conversations: z.string().url(),
      channels: z.string().url(),
      owner: z.string().url(),
    }),
  }),
  id: z.string(),
  name: z.string(),
  is_private: z.boolean(),
  is_public: z.boolean().optional(),
  address: z.string().optional(),
  send_as: z.string().optional(),
})

/**
 * Paginated inbox list schema
 */
export const InboxListSchema = PaginatedResponseSchema(InboxSchema)

/**
 * Schema for creating a new inbox
 */
export const CreateInboxSchema = z.object({
  name: z.string(),
  teammate_ids: z.array(z.string()).optional(),
})

export type Inbox = z.infer<typeof InboxSchema>
export type InboxList = z.infer<typeof InboxListSchema>
export type CreateInbox = z.infer<typeof CreateInboxSchema>
