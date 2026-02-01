import { sql } from 'drizzle-orm'
import {
  boolean,
  datetime,
  double,
  int,
  json,
  mysqlTable,
  text,
  unique,
  varchar,
} from 'drizzle-orm/mysql-core'

/**
 * Multi-product registry tracking integrated apps and their capabilities
 */
export const AppsTable = mysqlTable('SUPPORT_apps', {
  id: varchar('id', { length: 255 }).primaryKey(),
  slug: varchar('slug', { length: 255 }).notNull().unique(),
  name: varchar('name', { length: 255 }).notNull(),

  front_inbox_id: varchar('front_inbox_id', { length: 255 }).notNull(),
  instructor_teammate_id: varchar('instructor_teammate_id', { length: 255 }),

  stripe_account_id: varchar('stripe_account_id', { length: 255 }),
  stripe_connected: boolean('stripe_connected').default(false),

  integration_base_url: text('integration_base_url').notNull(),
  webhook_secret: varchar('webhook_secret', { length: 255 }).notNull(),
  capabilities: json('capabilities').$type<string[]>().notNull(),

  auto_approve_refund_days: int('auto_approve_refund_days').default(30),
  auto_approve_transfer_days: int('auto_approve_transfer_days').default(14),
  escalation_slack_channel: varchar('escalation_slack_channel', {
    length: 255,
  }),

  created_at: datetime('created_at').default(sql`CURRENT_TIMESTAMP`),
  updated_at: datetime('updated_at')
    .default(sql`CURRENT_TIMESTAMP`)
    .$onUpdateFn(() => new Date()),
})

/**
 * Front conversation tracking with app association and agent state
 */
export const ConversationsTable = mysqlTable('SUPPORT_conversations', {
  id: varchar('id', { length: 255 }).primaryKey(),
  front_conversation_id: varchar('front_conversation_id', { length: 255 })
    .notNull()
    .unique(),
  app_id: varchar('app_id', { length: 255 }), // FK to AppsTable.id (enforced at app level)

  customer_email: varchar('customer_email', { length: 255 }).notNull(),
  customer_name: varchar('customer_name', { length: 255 }),

  status: varchar('status', {
    length: 50,
    enum: ['open', 'active', 'archived', 'resolved'],
  })
    .notNull()
    .default('open'),
  assigned_to: varchar('assigned_to', { length: 255 }),

  last_agent_run_id: varchar('last_agent_run_id', { length: 255 }),
  last_agent_action: text('last_agent_action'),

  created_at: datetime('created_at').default(sql`CURRENT_TIMESTAMP`),
  updated_at: datetime('updated_at')
    .default(sql`CURRENT_TIMESTAMP`)
    .$onUpdateFn(() => new Date()),
})

/**
 * Agent tool executions with approval workflow and observability tracking
 */
export const ActionsTable = mysqlTable('SUPPORT_actions', {
  id: varchar('id', { length: 255 }).primaryKey(),
  conversation_id: varchar('conversation_id', { length: 255 }), // FK to ConversationsTable.id (enforced at app level)
  app_id: varchar('app_id', { length: 255 }), // FK to AppsTable.id (enforced at app level)

  type: varchar('type', { length: 255 }).notNull(),
  parameters: json('parameters').$type<Record<string, unknown>>().notNull(),

  // Classification metadata (promoted from parameters.context for queryability)
  category: varchar('category', { length: 100 }),
  confidence: double('confidence'),
  reasoning: text('reasoning'),

  requires_approval: boolean('requires_approval').default(false),
  approved_by: varchar('approved_by', { length: 255 }),
  approved_at: datetime('approved_at'),
  rejected_by: varchar('rejected_by', { length: 255 }),
  rejected_at: datetime('rejected_at'),
  rejection_reason: text('rejection_reason'),

  executed_at: datetime('executed_at'),
  result: json('result').$type<Record<string, unknown>>(),
  error: text('error'),

  trace_id: varchar('trace_id', { length: 255 }),
  langfuse_trace_id: varchar('langfuse_trace_id', { length: 255 }),

  created_at: datetime('created_at').default(sql`CURRENT_TIMESTAMP`),
})

/**
 * Human-in-the-loop approval requests with Slack integration
 */
export const ApprovalRequestsTable = mysqlTable('SUPPORT_approval_requests', {
  id: varchar('id', { length: 255 }).primaryKey(),
  action_id: varchar('action_id', { length: 255 }), // FK to ActionsTable.id (enforced at app level)

  slack_message_ts: varchar('slack_message_ts', { length: 255 }),
  slack_channel: varchar('slack_channel', { length: 255 }),

  status: varchar('status', {
    length: 50,
    enum: ['pending', 'approved', 'rejected', 'expired'],
  })
    .notNull()
    .default('pending'),

  agent_reasoning: text('agent_reasoning'),

  expires_at: datetime('expires_at'),
  created_at: datetime('created_at').default(sql`CURRENT_TIMESTAMP`),
})

/**
 * Comprehensive audit log for all agent actions and executions
 * Separate from ActionsTable (approval workflow) - this is for observability/debugging
 */
export const AuditLogTable = mysqlTable('SUPPORT_audit_log', {
  id: varchar('id', { length: 255 }).primaryKey(),
  conversation_id: varchar('conversation_id', { length: 255 }), // FK to ConversationsTable.id (enforced at app level)
  app_id: varchar('app_id', { length: 255 }), // FK to AppsTable.id (enforced at app level)

  action_type: varchar('action_type', {
    length: 50,
    enum: [
      'tool_execution',
      'agent_run',
      'approval_request',
      'approval_response',
    ],
  }).notNull(),

  tool_name: varchar('tool_name', { length: 255 }),
  parameters: json('parameters').$type<Record<string, unknown>>().notNull(),
  result: json('result').$type<Record<string, unknown>>(),
  error: text('error'),

  duration_ms: int('duration_ms'),
  token_usage: json('token_usage').$type<{ input: number; output: number }>(),

  trace_id: varchar('trace_id', { length: 255 }),

  created_at: datetime('created_at').default(sql`CURRENT_TIMESTAMP`),
})

// Type exports for type-safe database operations
export type App = typeof AppsTable.$inferSelect
export type NewApp = typeof AppsTable.$inferInsert

export type Conversation = typeof ConversationsTable.$inferSelect
export type NewConversation = typeof ConversationsTable.$inferInsert

export type Action = typeof ActionsTable.$inferSelect
export type NewAction = typeof ActionsTable.$inferInsert

export type ApprovalRequest = typeof ApprovalRequestsTable.$inferSelect
export type NewApprovalRequest = typeof ApprovalRequestsTable.$inferInsert

export type AuditLog = typeof AuditLogTable.$inferSelect
export type NewAuditLog = typeof AuditLogTable.$inferInsert

/**
 * Raw webhook payload snapshots for debugging preview vs full message differences.
 */
export const WebhookPayloadSnapshotsTable = mysqlTable(
  'SUPPORT_webhook_payload_snapshots',
  {
    id: varchar('id', { length: 255 }).primaryKey(),
    source: varchar('source', { length: 50 }).notNull(),
    event_type: varchar('event_type', { length: 100 }),
    conversation_id: varchar('conversation_id', { length: 255 }),
    message_id: varchar('message_id', { length: 255 }),
    app_id: varchar('app_id', { length: 255 }),
    inbox_id: varchar('inbox_id', { length: 255 }),

    payload: json('payload').$type<Record<string, unknown>>(),
    payload_raw: text('payload_raw'),

    subject: text('subject'),
    body: text('body'),
    sender_email: varchar('sender_email', { length: 255 }),
    body_length: int('body_length'),
    has_body: boolean('has_body'),
    has_subject: boolean('has_subject'),
    has_sender_email: boolean('has_sender_email'),

    preview_differs: boolean('preview_differs'),
    diff_fields: json('diff_fields').$type<string[]>(),

    created_at: datetime('created_at').default(sql`CURRENT_TIMESTAMP`),
    updated_at: datetime('updated_at')
      .default(sql`CURRENT_TIMESTAMP`)
      .$onUpdateFn(() => new Date()),
  }
)

export type WebhookPayloadSnapshot =
  typeof WebhookPayloadSnapshotsTable.$inferSelect
export type NewWebhookPayloadSnapshot =
  typeof WebhookPayloadSnapshotsTable.$inferInsert

/**
 * Trust scores for auto-send decision making
 * Tracks success rate of agent responses by app and category with exponential decay
 */
export const TrustScoresTable = mysqlTable(
  'SUPPORT_trust_scores',
  {
    id: varchar('id', { length: 255 }).primaryKey(),
    app_id: varchar('app_id', { length: 255 }).notNull(), // FK to AppsTable.id (enforced at app level)
    category: varchar('category', { length: 100 }).notNull(),

    trust_score: double('trust_score').notNull().default(0.5),
    sample_count: int('sample_count').notNull().default(0),

    decay_half_life_days: int('decay_half_life_days').notNull().default(30),

    last_updated_at: datetime('last_updated_at')
      .default(sql`CURRENT_TIMESTAMP`)
      .$onUpdateFn(() => new Date()),
    created_at: datetime('created_at').default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    // Composite unique constraint ensures one trust score per app/category pair
    appCategoryUnique: unique().on(table.app_id, table.category),
  })
)

export type TrustScore = typeof TrustScoresTable.$inferSelect
export type NewTrustScore = typeof TrustScoresTable.$inferInsert

/**
 * Dead letter queue for failed event processing
 * Stores failed Inngest events after max retries for debugging and replay
 */
export const DeadLetterQueueTable = mysqlTable('SUPPORT_dead_letter_queue', {
  id: varchar('id', { length: 255 }).primaryKey(),
  event_name: varchar('event_name', { length: 255 }).notNull(),
  event_data: json('event_data').$type<Record<string, unknown>>().notNull(),

  error_message: text('error_message').notNull(),
  error_stack: text('error_stack'),

  retry_count: int('retry_count').notNull().default(0),
  consecutive_failures: int('consecutive_failures').notNull().default(1),

  first_failed_at: datetime('first_failed_at').notNull(),
  last_failed_at: datetime('last_failed_at')
    .default(sql`CURRENT_TIMESTAMP`)
    .$onUpdateFn(() => new Date()),

  alerted_at: datetime('alerted_at'),
  resolved_at: datetime('resolved_at'),

  created_at: datetime('created_at').default(sql`CURRENT_TIMESTAMP`),
})

export type DeadLetterQueueEntry = typeof DeadLetterQueueTable.$inferSelect
export type NewDeadLetterQueueEntry = typeof DeadLetterQueueTable.$inferInsert
