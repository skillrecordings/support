/**
 * Typed event definitions for the support workflow system.
 *
 * All events follow Inngest's typed event pattern with EventSchemas.
 * Event names are exported as const for type safety.
 */

import type Stripe from 'stripe'

/** Event emitted when an inbound support message is received from Front */
export const SUPPORT_INBOUND_RECEIVED = 'support/inbound.received' as const

export type SupportInboundReceivedEvent = {
  name: typeof SUPPORT_INBOUND_RECEIVED
  data: {
    /** Front conversation ID */
    conversationId: string
    /** Skill Recordings app identifier or inbox ID */
    appId: string
    /** Front message ID */
    messageId: string
    /** Optional subject line (may be empty from webhook preview) */
    subject?: string
    /** Message body text (empty from webhook - must fetch via Front API) */
    body: string
    /** Sender's email address (empty from webhook - must fetch via Front API) */
    senderEmail: string
    /** Front API links for fetching full data */
    _links?: {
      conversation?: string
      message?: string
    }
    /** Optional: message body for testing/fallback (alias for body) */
    messageBody?: string
    /** Optional: customer email for testing/fallback (alias for senderEmail) */
    customerEmail?: string
    /** Optional: inbox ID from webhook */
    inboxId?: string
  }
}

/** Event emitted when an agent action requires human approval */
export const SUPPORT_APPROVAL_REQUESTED = 'support/approval.requested' as const

export type SupportApprovalRequestedEvent = {
  name: typeof SUPPORT_APPROVAL_REQUESTED
  data: {
    /** Unique action ID for tracking */
    actionId: string
    /** Associated conversation ID */
    conversationId: string
    /** App this action is for */
    appId: string
    /** Action being requested (refund, license transfer, etc) */
    action: {
      type: string
      parameters: Record<string, unknown>
    }
    /** Agent's reasoning for proposing this action */
    agentReasoning: string
    /** Customer email (for Slack context) */
    customerEmail?: string
    /** Inbox ID (for Slack context) */
    inboxId?: string
  }
}

/** Event emitted when a human approves an action */
export const SUPPORT_ACTION_APPROVED = 'support/action.approved' as const

export type SupportActionApprovedEvent = {
  name: typeof SUPPORT_ACTION_APPROVED
  data: {
    /** Action ID being approved */
    actionId: string
    /** User who approved (email or ID) */
    approvedBy: string
    /** Approval timestamp */
    approvedAt: string
  }
}

/** Event emitted when a human rejects an action */
export const SUPPORT_ACTION_REJECTED = 'support/action.rejected' as const

export type SupportActionRejectedEvent = {
  name: typeof SUPPORT_ACTION_REJECTED
  data: {
    /** Action ID being rejected */
    actionId: string
    /** User who rejected (email or ID) */
    rejectedBy: string
    /** Rejection timestamp */
    rejectedAt: string
    /** Optional reason for rejection */
    reason?: string
  }
}

/** Event emitted when an approval decision is made (approved or rejected) */
export const SUPPORT_APPROVAL_DECIDED = 'support/approval.decided' as const

export type SupportApprovalDecidedEvent = {
  name: typeof SUPPORT_APPROVAL_DECIDED
  data: {
    /** Action ID being decided on */
    actionId: string
    /** Decision: approved or rejected */
    decision: 'approved' | 'rejected'
    /** User who made the decision */
    decidedBy: string
    /** Decision timestamp */
    decidedAt: string
    /** Optional reason (typically for rejections) */
    reason?: string
  }
}

/** Event emitted when a Stripe webhook event is received */
export const STRIPE_EVENT_RECEIVED = 'stripe/event.received' as const

export type StripeEventReceivedEvent = {
  name: typeof STRIPE_EVENT_RECEIVED
  data: {
    /** Stripe event type (e.g., charge.refunded) */
    type: string
    /** Stripe event data object */
    data: Stripe.Event['data']['object']
    /** Stripe Connect account ID if from connected account */
    accountId?: string
  }
}

/** Event emitted when a Stripe refund is successfully completed */
export const STRIPE_REFUND_COMPLETED = 'stripe/refund.completed' as const

export type StripeRefundCompletedEvent = {
  name: typeof STRIPE_REFUND_COMPLETED
  data: {
    /** Refund ID */
    refundId: string
    /** Charge ID that was refunded */
    chargeId: string
    /** Amount refunded in cents */
    amount: number
    /** Currency code */
    currency: string
    /** Stripe Connect account ID if applicable */
    accountId?: string
    /** Associated conversation ID if known */
    conversationId?: string
  }
}

/** Event emitted when a conversation is resolved and ready for indexing */
export const SUPPORT_CONVERSATION_RESOLVED =
  'support/conversation.resolved' as const

export type SupportConversationResolvedEvent = {
  name: typeof SUPPORT_CONVERSATION_RESOLVED
  data: {
    /** Front conversation ID */
    conversationId: string
    /** Skill Recordings app identifier */
    appId: string
    /** Customer email address */
    customerEmail: string
    /** Conversation messages */
    messages: Array<{
      role: 'customer' | 'agent'
      content: string
      timestamp: string
    }>
    /** Resolution metadata */
    resolution: {
      /** Resolution category */
      category: string
      /** Whether response was auto-sent */
      wasAutoSent: boolean
      /** Whether agent draft was used */
      agentDraftUsed: boolean
      /** Optional trust score */
      trustScore?: number
    }
  }
}

/** Event emitted when memory voting is requested after a resolution */
export const MEMORY_VOTE_REQUESTED = 'memory/vote.requested' as const

export type MemoryVoteRequestedEvent = {
  name: typeof MEMORY_VOTE_REQUESTED
  data: {
    /** Inngest run ID for traceability */
    run_id: string
    /** Outcome of the resolution */
    outcome: 'success' | 'failure' | 'rejection'
    /** Memory IDs that were cited in this resolution */
    cited_memories: string[]
    /** Collection the memories belong to */
    collection: string
    /** Optional: app slug for filtering */
    app_slug?: string
    /** Optional: additional context about the outcome */
    context?: {
      resolution_summary?: string
      customer_satisfied?: boolean
      rejection_reason?: string
    }
  }
}

/** Event emitted when memories are cited during agent execution */
export const MEMORY_CITED = 'memory/cited' as const

export type MemoryCitedEvent = {
  name: typeof MEMORY_CITED
  data: {
    /** Memory IDs that were cited */
    memoryIds: string[]
    /** Inngest run ID for traceability */
    runId: string
    /** Associated conversation ID */
    conversationId: string
    /** App identifier */
    appId: string
    /** Collection the memories belong to */
    collection: string
  }
}

/** Event emitted when a memory outcome is recorded */
export const MEMORY_OUTCOME_RECORDED = 'memory/outcome.recorded' as const

export type MemoryOutcomeRecordedEvent = {
  name: typeof MEMORY_OUTCOME_RECORDED
  data: {
    /** Memory IDs associated with the outcome */
    memoryIds: string[]
    /** Inngest run ID for traceability */
    runId: string
    /** Associated conversation ID */
    conversationId: string
    /** Outcome of the interaction */
    outcome: 'success' | 'failure'
    /** Collection the memories belong to */
    collection: string
  }
}

// ============================================================================
// Pipeline Events (event-driven workflow chain)
// ============================================================================

/** Event emitted after message classification */
export const SUPPORT_CLASSIFIED = 'support/inbound.classified' as const

export type SupportClassifiedEvent = {
  name: typeof SUPPORT_CLASSIFIED
  data: {
    conversationId: string
    messageId: string
    appId: string
    subject: string
    body: string
    senderEmail: string
    classification: {
      category: string
      confidence: number
      signals: Record<string, boolean>
      reasoning?: string
    }
  }
}

/** Event emitted after routing decision */
export const SUPPORT_ROUTED = 'support/inbound.routed' as const

export type SupportRoutedEvent = {
  name: typeof SUPPORT_ROUTED
  data: {
    conversationId: string
    messageId: string
    appId: string
    subject: string
    body: string
    senderEmail: string
    classification: {
      category: string
      confidence: number
      signals: Record<string, boolean>
    }
    route: {
      action:
        | 'respond'
        | 'escalate_human'
        | 'escalate_instructor'
        | 'escalate_urgent'
        | 'silence'
      reason: string
    }
  }
}

/** Event emitted after context gathering */
export const SUPPORT_CONTEXT_GATHERED = 'support/context.gathered' as const

export type SupportContextGatheredEvent = {
  name: typeof SUPPORT_CONTEXT_GATHERED
  data: {
    conversationId: string
    messageId: string
    appId: string
    classification: {
      category: string
      confidence: number
    }
    route: {
      action: string
      reason: string
    }
    context: {
      customer: {
        email: string
        purchases: unknown[]
        trustScore?: number
      } | null
      knowledge: unknown[]
      memories: unknown[]
    }
  }
}

/** Event emitted after draft creation */
export const SUPPORT_DRAFT_CREATED = 'support/draft.created' as const

export type SupportDraftCreatedEvent = {
  name: typeof SUPPORT_DRAFT_CREATED
  data: {
    conversationId: string
    messageId: string
    appId: string
    draft: {
      content: string
      toolsUsed: string[]
    }
    context: unknown
  }
}

/** Event emitted after draft validation */
export const SUPPORT_DRAFT_VALIDATED = 'support/draft.validated' as const

export type SupportDraftValidatedEvent = {
  name: typeof SUPPORT_DRAFT_VALIDATED
  data: {
    conversationId: string
    messageId: string
    appId: string
    draft: {
      content: string
    }
    validation: {
      valid: boolean
      issues: string[]
      score?: number
    }
    context?: {
      customerEmail?: string
      purchaseCount?: number
      knowledgeCount?: number
      memoryCount?: number
      category?: string
      confidence?: number
      reasoning?: string
    }
  }
}

/** Event emitted when routing decides to escalate */
export const SUPPORT_ESCALATED = 'support/inbound.escalated' as const

/** Event emitted to trigger manual template sync */
export const TEMPLATES_SYNC_REQUESTED = 'templates/sync.requested' as const

export type TemplatesSyncRequestedEvent = {
  name: typeof TEMPLATES_SYNC_REQUESTED
  data: {
    /** Optional: specific app to sync (syncs all if not provided) */
    appId?: string
    /** Optional: requestor info for audit */
    requestedBy?: string
  }
}

/** Event emitted to trigger manual stale template check */
export const STALE_TEMPLATES_CHECK_REQUESTED =
  'templates/stale-check.requested' as const

export type StaleTemplatesCheckRequestedEvent = {
  name: typeof STALE_TEMPLATES_CHECK_REQUESTED
  data: {
    /** Optional: specific app to check (checks all if not provided) */
    appId?: string
    /** Optional: override unused days threshold */
    unusedDays?: number
    /** Optional: requestor info for audit */
    requestedBy?: string
  }
}

export type EscalationPriority =
  | 'urgent'
  | 'normal'
  | 'instructor'
  | 'teammate_support'
  | 'voc'

export type SupportEscalatedEvent = {
  name: typeof SUPPORT_ESCALATED
  data: {
    conversationId: string
    messageId: string
    appId: string
    subject: string
    body: string
    senderEmail: string
    classification: {
      category: string
      confidence: number
      signals: Record<string, boolean>
      reasoning?: string
    }
    route: {
      action: string
      reason: string
    }
    priority: EscalationPriority
  }
}

/**
 * Union of all support platform events.
 * Used to type the Inngest client.
 */
export type Events = {
  [SUPPORT_INBOUND_RECEIVED]: SupportInboundReceivedEvent
  [SUPPORT_APPROVAL_REQUESTED]: SupportApprovalRequestedEvent
  [SUPPORT_ACTION_APPROVED]: SupportActionApprovedEvent
  [SUPPORT_ACTION_REJECTED]: SupportActionRejectedEvent
  [SUPPORT_APPROVAL_DECIDED]: SupportApprovalDecidedEvent
  [STRIPE_EVENT_RECEIVED]: StripeEventReceivedEvent
  [STRIPE_REFUND_COMPLETED]: StripeRefundCompletedEvent
  [SUPPORT_CONVERSATION_RESOLVED]: SupportConversationResolvedEvent
  [MEMORY_VOTE_REQUESTED]: MemoryVoteRequestedEvent
  [MEMORY_CITED]: MemoryCitedEvent
  [MEMORY_OUTCOME_RECORDED]: MemoryOutcomeRecordedEvent
  // Pipeline events
  [SUPPORT_CLASSIFIED]: SupportClassifiedEvent
  [SUPPORT_ROUTED]: SupportRoutedEvent
  [SUPPORT_CONTEXT_GATHERED]: SupportContextGatheredEvent
  [SUPPORT_DRAFT_CREATED]: SupportDraftCreatedEvent
  [SUPPORT_DRAFT_VALIDATED]: SupportDraftValidatedEvent
  [SUPPORT_ESCALATED]: SupportEscalatedEvent
  // Template sync events
  [TEMPLATES_SYNC_REQUESTED]: TemplatesSyncRequestedEvent
  // Stale template check events
  [STALE_TEMPLATES_CHECK_REQUESTED]: StaleTemplatesCheckRequestedEvent
}
