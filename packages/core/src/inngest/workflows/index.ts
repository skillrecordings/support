/**
 * Workflow exports for the support platform.
 *
 * All Inngest workflows are exported here for the serve handler.
 */

// DELETED: export { handleInboundMessage } from './handle-inbound-message'
// Replaced by event-driven workflows: classify, route, gather, draft, validate, handle-validated-draft
export { requestApproval } from './request-approval'
export { executeApprovedAction } from './execute-approved-action'
export { handleStripeEvent } from './stripe-refund'
export { indexConversation } from './index-conversation'
export { retentionCleanup } from './retention-cleanup'
export { handleMemoryVote } from './memory-vote'
export { routeWorkflow } from './route-message'
export { classifyWorkflow } from './classify'
export { gatherWorkflow } from './gather-context'
export { draftWorkflow } from './draft-response'
export { validateWorkflow } from './validate-draft'
export { handleValidatedDraft } from './handle-validated-draft'
export { syncTemplatesWorkflow, syncTemplatesOnDemand } from './sync-templates'
export { handleEscalation } from './handle-escalation'

import { classifyWorkflow } from './classify'
import { draftWorkflow } from './draft-response'
import { executeApprovedAction } from './execute-approved-action'
import { gatherWorkflow } from './gather-context'
import { handleEscalation } from './handle-escalation'
import { handleValidatedDraft } from './handle-validated-draft'
// DELETED: import { handleInboundMessage } from './handle-inbound-message'
import { indexConversation } from './index-conversation'
import { handleMemoryVote } from './memory-vote'
import { requestApproval } from './request-approval'
import { retentionCleanup } from './retention-cleanup'
import { routeWorkflow } from './route-message'
import { handleStripeEvent } from './stripe-refund'
import { syncTemplatesOnDemand, syncTemplatesWorkflow } from './sync-templates'
import { validateWorkflow } from './validate-draft'

/**
 * Array of all workflow functions for the Inngest serve handler.
 *
 * Usage in serve route:
 * ```typescript
 * serve({ client: inngest, functions: allWorkflows })
 * ```
 */
export const allWorkflows = [
  classifyWorkflow,
  draftWorkflow,
  gatherWorkflow,
  handleEscalation,
  // DELETED: handleInboundMessage - replaced by event-driven workflows
  handleValidatedDraft,
  requestApproval,
  executeApprovedAction,
  handleStripeEvent,
  indexConversation,
  retentionCleanup,
  handleMemoryVote,
  routeWorkflow,
  validateWorkflow,
  syncTemplatesWorkflow,
  syncTemplatesOnDemand,
]
