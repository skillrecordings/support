import { z } from 'zod'
import { PaginatedResponseSchema } from './common'

/**
 * Recipient schema for message recipients
 * Represents an email/message recipient with their role
 */
export const RecipientSchema = z.object({
  _links: z
    .object({
      related: z
        .object({
          contact: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
  handle: z.string(),
  role: z.enum(['from', 'to', 'cc', 'bcc']),
  name: z.string().nullable().optional(),
})

export type Recipient = z.infer<typeof RecipientSchema>

/**
 * Author schema for message authors (teammates)
 * Represents a teammate who authored a message
 */
export const AuthorSchema = z.object({
  _links: z
    .object({
      self: z.string(),
      related: z.object({
        inboxes: z.string(),
        conversations: z.string(),
      }),
    })
    .optional(),
  id: z.string(),
  email: z.string(),
  username: z.string().optional(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  is_admin: z.boolean().optional(),
  is_available: z.boolean().optional(),
  is_blocked: z.boolean().optional(),
})

export type Author = z.infer<typeof AuthorSchema>

/**
 * Attachment schema for Front API messages and templates
 * Represents files attached to messages or message templates
 */
export const AttachmentSchema = z.object({
  id: z.string(),
  filename: z.string(),
  url: z.string(),
  content_type: z.string(),
  size: z.number(),
  metadata: z.object({
    is_inline: z.boolean(),
    cid: z.string().optional(),
  }),
})

export type Attachment = z.infer<typeof AttachmentSchema>

/**
 * Signature schema for message signatures
 */
export const SignatureSchema = z.object({
  id: z.string(),
  name: z.string(),
  body: z.string(),
  is_default: z.boolean().optional(),
})

export type Signature = z.infer<typeof SignatureSchema>

/**
 * Message schema for Front API messages
 * Represents a message in a conversation
 */
export const MessageSchema = z.object({
  _links: z.object({
    self: z.string(),
    related: z.object({
      conversation: z.string(),
      message_replied_to: z.string().optional(),
    }),
  }),
  id: z.string(),
  type: z.enum([
    'email',
    'tweet',
    'sms',
    'smooch',
    'facebook',
    'intercom',
    'call',
    'custom',
  ]),
  is_inbound: z.boolean(),
  is_draft: z.boolean(),
  error_type: z.string().nullable(),
  version: z.string().nullable(),
  created_at: z.number(),
  subject: z.string().nullable(),
  blurb: z.string(),
  body: z.string(),
  text: z.string().nullable(),
  author: AuthorSchema.nullable(),
  recipients: z.array(RecipientSchema),
  attachments: z.array(AttachmentSchema),
  signature: SignatureSchema.nullable().optional(),
  metadata: z
    .object({
      headers: z.record(z.string(), z.string()).optional(),
      thread_ref: z.string().optional(),
      is_forward: z.boolean().optional(),
    })
    .optional(),
})

export type Message = z.infer<typeof MessageSchema>

/**
 * Paginated message list schema
 */
export const MessageListSchema = PaginatedResponseSchema(MessageSchema)

export type MessageList = z.infer<typeof MessageListSchema>

/**
 * Create message request schema
 * Used when creating a new message via a channel
 */
export const CreateMessageSchema = z.object({
  to: z.array(z.string()),
  cc: z.array(z.string()).optional(),
  bcc: z.array(z.string()).optional(),
  subject: z.string().optional(),
  body: z.string(),
  author_id: z.string().optional(),
  attachments: z.array(z.string()).optional(), // Attachment IDs
})

export type CreateMessage = z.infer<typeof CreateMessageSchema>
