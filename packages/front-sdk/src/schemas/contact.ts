import { z } from 'zod/v4'
import { PaginatedResponseSchema } from './common'

export const ContactHandleSourceSchema = z.enum([
  'email',
  'phone',
  'twitter',
  'facebook',
  'intercom',
  'front_chat',
  'custom',
])

export const ContactHandleSchema = z.object({
  handle: z.string(),
  source: ContactHandleSourceSchema,
})

export const ContactGroupSchema = z.object({
  _links: z.object({ self: z.string() }),
  id: z.string(),
  name: z.string(),
})

export const ContactSchema = z.object({
  _links: z.object({
    self: z.string(),
    related: z.object({
      notes: z.string(),
      conversations: z.string(),
      owner: z.string().optional(),
    }),
  }),
  id: z.string(),
  name: z.string().nullable(),
  description: z.string().nullable(),
  avatar_url: z.string().nullable(),
  is_spammer: z.boolean(),
  links: z.array(z.string()),
  groups: z.array(ContactGroupSchema),
  handles: z.array(ContactHandleSchema),
  custom_fields: z.record(z.string(), z.unknown()),
  is_private: z.boolean().optional(),
})

export const ContactListSchema = PaginatedResponseSchema(ContactSchema)

export const CreateContactSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  handles: z.array(ContactHandleSchema),
  group_names: z.array(z.string()).optional(),
  custom_fields: z.record(z.string(), z.unknown()).optional(),
})

export const UpdateContactSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  avatar: z.string().optional(), // base64 or URL
  is_spammer: z.boolean().optional(),
  custom_fields: z.record(z.string(), z.unknown()).optional(),
})

export type Contact = z.infer<typeof ContactSchema>
export type ContactList = z.infer<typeof ContactListSchema>
export type ContactHandle = z.infer<typeof ContactHandleSchema>
export type ContactHandleSource = z.infer<typeof ContactHandleSourceSchema>
export type ContactGroup = z.infer<typeof ContactGroupSchema>
export type CreateContact = z.infer<typeof CreateContactSchema>
export type UpdateContact = z.infer<typeof UpdateContactSchema>
