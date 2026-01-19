import { z } from 'zod/v4'
import { PaginatedResponseSchema } from './common'
import { AttachmentSchema, AuthorSchema, RecipientSchema } from './message'

/**
 * Draft schema for Front API drafts
 * Drafts are messages that haven't been sent yet
 */
export const DraftSchema = z.object({
  _links: z.object({
    self: z.string(),
    related: z.object({
      conversation: z.string(),
      message_replied_to: z.string().optional(),
    }),
  }),
  id: z.string(),
  version: z.string(),
  author: AuthorSchema,
  recipients: z.array(RecipientSchema),
  body: z.string(),
  subject: z.string().nullable(),
  attachments: z.array(AttachmentSchema),
  created_at: z.number(),
  channel_id: z.string().optional(),
})

export type Draft = z.infer<typeof DraftSchema>

/**
 * Paginated draft list schema
 */
export const DraftListSchema = PaginatedResponseSchema(DraftSchema)

export type DraftList = z.infer<typeof DraftListSchema>

/**
 * Create draft request schema
 * Used for creating new drafts on a channel or conversation
 */
export const CreateDraftSchema = z.object({
  body: z.string(),
  channel_id: z.string(),
  author_id: z.string().optional(),
  to: z.array(z.string()).optional(),
  cc: z.array(z.string()).optional(),
  bcc: z.array(z.string()).optional(),
  subject: z.string().optional(),
  signature_id: z.string().optional(),
  mode: z.enum(['private', 'shared']).optional(),
})

export type CreateDraft = z.infer<typeof CreateDraftSchema>

/**
 * Edit draft request schema
 * Requires version for optimistic locking
 */
export const EditDraftSchema = z.object({
  body: z.string().optional(),
  to: z.array(z.string()).optional(),
  cc: z.array(z.string()).optional(),
  bcc: z.array(z.string()).optional(),
  subject: z.string().optional(),
  version: z.string(), // Required for optimistic locking
})

export type EditDraft = z.infer<typeof EditDraftSchema>
