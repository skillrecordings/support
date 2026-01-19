import { z } from 'zod/v4'
import { PaginatedResponseSchema } from './common'
import { AttachmentSchema } from './message'

/**
 * Message template folder schema
 * Folders are used to organize message templates
 */
export const MessageTemplateFolderSchema = z.object({
  _links: z.object({
    self: z.string(),
  }),
  id: z.string(),
  name: z.string(),
})

export type MessageTemplateFolder = z.infer<typeof MessageTemplateFolderSchema>

/**
 * Message template schema
 * Templates are reusable message drafts with subject, body, and optional attachments
 */
export const MessageTemplateSchema = z.object({
  _links: z.object({
    self: z.string(),
    related: z.object({
      owner: z.string(),
      folder: z.string().optional(),
    }),
  }),
  id: z.string(),
  name: z.string(),
  subject: z.string(),
  body: z.string(),
  is_available_for_all_inboxes: z.boolean(),
  attachments: z.array(AttachmentSchema).optional(),
  folder: z.string().nullable().optional(),
})

export type MessageTemplate = z.infer<typeof MessageTemplateSchema>

/**
 * Paginated message template list
 */
export const MessageTemplateListSchema = PaginatedResponseSchema(
  MessageTemplateSchema
)

export type MessageTemplateList = z.infer<typeof MessageTemplateListSchema>

/**
 * Paginated message template folder list
 */
export const MessageTemplateFolderListSchema = PaginatedResponseSchema(
  MessageTemplateFolderSchema
)

export type MessageTemplateFolderList = z.infer<
  typeof MessageTemplateFolderListSchema
>

/**
 * Schema for creating a new message template
 */
export const CreateMessageTemplateSchema = z.object({
  name: z.string(),
  subject: z.string(),
  body: z.string(),
  folder_id: z.string().optional(),
  inbox_ids: z.array(z.string()).optional(),
})

export type CreateMessageTemplate = z.infer<typeof CreateMessageTemplateSchema>

/**
 * Schema for updating an existing message template
 */
export const UpdateMessageTemplateSchema = z.object({
  name: z.string().optional(),
  subject: z.string().optional(),
  body: z.string().optional(),
  folder_id: z.string().nullable().optional(),
  inbox_ids: z.array(z.string()).optional(),
})

export type UpdateMessageTemplate = z.infer<typeof UpdateMessageTemplateSchema>
