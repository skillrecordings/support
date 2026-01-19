import { z } from 'zod/v4'
import { PaginatedResponseSchema } from './common'

/**
 * Recipient schema for conversation participants
 * Represents an email address or contact handle with role (from/to/cc/bcc)
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
 * Conversation status enum
 * Represents the current state of a conversation in Front
 */
export const ConversationStatusSchema = z.enum([
  'archived',
  'unassigned',
  'assigned',
  'deleted',
  'snoozed',
  'invisible',
])

export type ConversationStatus = z.infer<typeof ConversationStatusSchema>

/**
 * Tag schema for conversation tags
 */
export const TagSchema = z.object({
  id: z.string(),
  name: z.string(),
})

export type Tag = z.infer<typeof TagSchema>

/**
 * Link schema for conversation links
 */
export const LinkSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  external_url: z.string(),
})

export type Link = z.infer<typeof LinkSchema>

/**
 * Assignee (teammate) schema
 */
export const AssigneeSchema = z.object({
  id: z.string(),
  email: z.string(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
})

export type Assignee = z.infer<typeof AssigneeSchema>

/**
 * Reminder schema for scheduled reminders
 */
export const ReminderSchema = z.object({
  scheduled_at: z.number(),
})

export type Reminder = z.infer<typeof ReminderSchema>

/**
 * Conversation metadata schema
 */
export const ConversationMetadataSchema = z.object({
  external_conversation_ids: z.array(z.string()).optional(),
})

export type ConversationMetadata = z.infer<typeof ConversationMetadataSchema>

/**
 * Conversation schema (cnv_xxx)
 * Represents a complete conversation thread in Front
 */
export const ConversationSchema = z.object({
  _links: z.object({
    self: z.string(),
    related: z.object({
      events: z.string(),
      followers: z.string(),
      messages: z.string(),
      comments: z.string(),
      inboxes: z.string(),
    }),
  }),
  id: z.string(),
  subject: z.string(),
  status: ConversationStatusSchema,
  assignee: AssigneeSchema.nullable(),
  recipient: RecipientSchema,
  tags: z.array(TagSchema),
  links: z.array(LinkSchema),
  custom_fields: z.record(z.string(), z.unknown()).optional(),
  created_at: z.number(),
  waiting_since: z.number().optional(),
  is_private: z.boolean(),
  scheduled_reminders: z.array(ReminderSchema).optional(),
  metadata: ConversationMetadataSchema.optional(),
})

export type Conversation = z.infer<typeof ConversationSchema>

/**
 * Paginated conversation list schema
 */
export const ConversationListSchema =
  PaginatedResponseSchema(ConversationSchema)

export type ConversationList = z.infer<typeof ConversationListSchema>

/**
 * Schema for updating a conversation
 * Only includes fields that can be modified via PATCH
 */
export const UpdateConversationSchema = z.object({
  assignee_id: z.string().optional(),
  inbox_id: z.string().optional(),
  status: ConversationStatusSchema.optional(),
  tags: z.array(z.string()).optional(),
})

export type UpdateConversation = z.infer<typeof UpdateConversationSchema>
