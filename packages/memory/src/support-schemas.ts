import { z } from 'zod'
import { MemoryMetadataSchema, MemorySchema } from './schemas'

/**
 * Pipeline stages where decisions are made
 */
export const SupportStageSchema = z.enum([
  'classify',
  'route',
  'gather',
  'draft',
  'validate',
])

export type SupportStage = z.infer<typeof SupportStageSchema>

/**
 * Outcome after human review
 */
export const SupportOutcomeSchema = z.enum(['success', 'corrected', 'failed'])

export type SupportOutcome = z.infer<typeof SupportOutcomeSchema>

/**
 * Extended metadata for support memories
 */
export const SupportMemoryMetadataSchema = MemoryMetadataSchema.extend({
  /** Pipeline stage where decision was made */
  stage: SupportStageSchema,

  /** Outcome after human review (default: success, updated on feedback) */
  outcome: SupportOutcomeSchema.default('success'),

  /** What should have happened (populated when outcome is 'corrected') */
  correction: z.string().optional(),

  /** Support category (e.g., 'refund', 'access', 'technical') */
  category: z.string().optional(),

  /** Conversation ID for audit trail */
  conversation_id: z.string().optional(),
})

export type SupportMemoryMetadata = z.infer<typeof SupportMemoryMetadataSchema>

/**
 * Support memory record
 */
export const SupportMemorySchema = MemorySchema.extend({
  metadata: SupportMemoryMetadataSchema,
})

export type SupportMemory = z.infer<typeof SupportMemorySchema>

/**
 * Input for storing a new support memory
 */
export const StoreSupportMemoryInputSchema = z.object({
  /** Semantic description of the situation/context */
  situation: z.string().min(1),

  /** What was decided/done */
  decision: z.string().min(1),

  /** Pipeline stage */
  stage: SupportStageSchema,

  /** Initial outcome (default: success) */
  outcome: SupportOutcomeSchema.optional(),

  /** What should have happened (for 'corrected' outcome) */
  correction: z.string().optional(),

  /** Support category */
  category: z.string().optional(),

  /** App slug for namespacing */
  app_slug: z.string().optional(),

  /** Conversation ID for audit trail */
  conversation_id: z.string().optional(),

  /** Additional tags for filtering */
  tags: z.array(z.string()).optional(),
})

export type StoreSupportMemoryInput = z.infer<
  typeof StoreSupportMemoryInputSchema
>

/**
 * Options for finding similar support memories
 */
export const FindSimilarOptionsSchema = z.object({
  /** App slug filter */
  app_slug: z.string().optional(),

  /** Stage filter */
  stage: SupportStageSchema.optional(),

  /** Outcome filter */
  outcome: SupportOutcomeSchema.optional(),

  /** Category filter */
  category: z.string().optional(),

  /** Number of results (default: 10) */
  limit: z.number().int().positive().optional(),

  /** Minimum similarity threshold (default: 0.5) */
  threshold: z.number().min(0).max(1).optional(),

  /** Include stale (low-confidence) memories */
  include_stale: z.boolean().optional(),
})

export type FindSimilarOptions = z.infer<typeof FindSimilarOptionsSchema>

/**
 * Correction input
 */
export const CorrectionInputSchema = z.object({
  /** What should have happened */
  correction: z.string().min(1),

  /** Updated category if misclassified */
  category: z.string().optional(),
})

export type CorrectionInput = z.infer<typeof CorrectionInputSchema>

/**
 * Search result with support-specific fields
 */
export const SupportSearchResultSchema = z.object({
  memory: SupportMemorySchema,
  score: z.number(),
  raw_score: z.number(),
  age_days: z.number(),
  decay_factor: z.number().min(0).max(1),
})

export type SupportSearchResult = z.infer<typeof SupportSearchResultSchema>
