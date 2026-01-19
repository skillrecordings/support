import { z } from 'zod/v4'
import { PaginatedResponseSchema } from './common'

/**
 * Channel types supported by Front
 */
export const ChannelTypeSchema = z.enum([
  'smtp',
  'imap',
  'twilio',
  'twitter',
  'facebook',
  'intercom',
  'truly',
  'custom',
])

export type ChannelType = z.infer<typeof ChannelTypeSchema>

/**
 * Channel schema
 * Represents a communication channel in Front (email, SMS, social, etc.)
 */
export const ChannelSchema = z.object({
  _links: z.object({
    self: z.string().url(),
    related: z.object({
      inbox: z.string().url(),
      owner: z.string().url().optional(),
    }),
  }),
  id: z.string(),
  type: ChannelTypeSchema,
  address: z.string(),
  send_as: z.string().optional(),
  name: z.string().optional(),
  is_private: z.boolean().optional(),
  is_valid: z.boolean().optional(),
})

export type Channel = z.infer<typeof ChannelSchema>

/**
 * Paginated list of channels
 */
export const ChannelListSchema = PaginatedResponseSchema(ChannelSchema)

export type ChannelList = z.infer<typeof ChannelListSchema>

/**
 * Schema for creating a new channel
 */
export const CreateChannelSchema = z.object({
  type: ChannelTypeSchema,
  settings: z.record(z.string(), z.unknown()),
})

export type CreateChannel = z.infer<typeof CreateChannelSchema>

/**
 * Schema for updating a channel
 */
export const UpdateChannelSchema = z.object({
  name: z.string().optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
})

export type UpdateChannel = z.infer<typeof UpdateChannelSchema>
