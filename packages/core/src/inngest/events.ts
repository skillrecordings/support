/**
 * Typed event definitions for the support workflow system.
 *
 * All events follow Inngest's typed event pattern with EventSchemas.
 * Event names are exported as const for type safety.
 */

/** Event emitted when an inbound support message is received from Front */
export const SUPPORT_INBOUND_RECEIVED = 'support/inbound.received' as const

export type SupportInboundReceivedEvent = {
  name: typeof SUPPORT_INBOUND_RECEIVED
  data: {
    /** Front conversation ID */
    conversationId: string
    /** Skill Recordings app identifier (e.g., 'total-typescript') */
    appId: string
    /** Sender's email address */
    senderEmail: string
    /** Front message ID */
    messageId: string
    /** Optional subject line */
    subject?: string
    /** Message body text */
    body: string
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
    /** Approval ID (same as actionId) */
    approvalId: string
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
}
