import { z } from 'zod/v4'

/**
 * Links schema for Front API responses
 * Contains hypermedia links for resource navigation
 */
export const LinksSchema = z.object({
  self: z.string().url(),
})

export type Links = z.infer<typeof LinksSchema>

/**
 * Pagination schema for Front API responses
 * Contains optional next page URL for cursor-based pagination
 */
export const PaginationSchema = z.object({
  next: z.string().url().optional(),
})

export type Pagination = z.infer<typeof PaginationSchema>

/**
 * Generic paginated response schema
 * All Front API list endpoints follow this structure
 */
export function PaginatedResponseSchema<T extends z.ZodTypeAny>(
  resultSchema: T
) {
  return z.object({
    _pagination: PaginationSchema.optional(),
    _links: LinksSchema,
    _results: z.array(resultSchema),
  })
}

export type PaginatedResponse<T> = {
  _pagination?: Pagination
  _links: Links
  _results: T[]
}

/**
 * Error response schema for Front API errors
 * Returned when API requests fail (4xx/5xx status codes)
 */
export const ErrorResponseSchema = z.object({
  _error: z.object({
    status: z.number().int(),
    title: z.string(),
    message: z.string(),
    details: z.array(z.string()).optional(),
  }),
})

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>
