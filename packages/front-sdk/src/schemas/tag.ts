import { z } from 'zod'
import { PaginatedResponseSchema } from './common'

/**
 * Tag highlight color options
 * Used to visually distinguish tags in Front UI
 */
export const TagHighlightSchema = z.enum([
  'black',
  'grey',
  'pink',
  'red',
  'orange',
  'yellow',
  'green',
  'teal',
  'blue',
  'purple',
])

/**
 * Tag schema for Front API
 * Tags categorize conversations for organization and filtering
 */
export const TagSchema = z.object({
  _links: z.object({
    self: z.string(),
    related: z.object({
      conversations: z.string(),
      owner: z.string(),
      children: z.string().optional(),
    }),
  }),
  id: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  highlight: TagHighlightSchema.nullable().optional(),
  is_private: z.boolean(),
  is_visible_in_conversation_lists: z.boolean().optional(),
  created_at: z.number().optional(),
  updated_at: z.number().optional(),
})

export const TagListSchema = PaginatedResponseSchema(TagSchema)

export const CreateTagSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  highlight: TagHighlightSchema.optional(),
})

export const UpdateTagSchema = z.object({
  name: z.string().optional(),
  description: z.string().nullable().optional(),
  highlight: TagHighlightSchema.nullable().optional(),
})

export type Tag = z.infer<typeof TagSchema>
export type TagList = z.infer<typeof TagListSchema>
