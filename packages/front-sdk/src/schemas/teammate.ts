import { z } from 'zod'
import { PaginatedResponseSchema } from './common'

/**
 * Teammate schema for Front API
 * Represents a teammate/user in the Front workspace
 */
export const TeammateSchema = z.object({
  _links: z.object({
    self: z.string(),
    related: z.object({
      inboxes: z.string(),
      conversations: z.string(),
    }),
  }),
  id: z.string(),
  email: z.string(),
  username: z.string(),
  first_name: z.string(),
  last_name: z.string(),
  is_admin: z.boolean(),
  is_available: z.boolean(),
  is_blocked: z.boolean(),
  custom_fields: z.record(z.string(), z.unknown()).optional(),
})

export type Teammate = z.infer<typeof TeammateSchema>

/**
 * Paginated list of teammates
 */
export const TeammateListSchema = PaginatedResponseSchema(TeammateSchema)

export type TeammateList = z.infer<typeof TeammateListSchema>

/**
 * Schema for updating a teammate
 */
export const UpdateTeammateSchema = z.object({
  username: z.string().optional(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  is_available: z.boolean().optional(),
  custom_fields: z.record(z.string(), z.unknown()).optional(),
})

export type UpdateTeammate = z.infer<typeof UpdateTeammateSchema>
