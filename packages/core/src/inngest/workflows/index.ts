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
export { handleMemoryVote, handleMemoryCitation } from './memory-vote'
export { routeWorkflow } from './route-message'
export { classifyWorkflow } from './classify'
export { gatherWorkflow } from './gather-context'
export { draftWorkflow } from './draft-response'
export { validateWorkflow } from './validate-draft'
export { handleValidatedDraft } from './handle-validated-draft'
export { syncTemplatesWorkflow, syncTemplatesOnDemand } from './sync-templates'
export { handleEscalation } from './handle-escalation'
export {
  findStaleTemplatesWorkflow,
  findStaleTemplatesOnDemand,
} from './find-stale-templates'
export {
  tagGardeningWorkflow,
  tagGardeningOnDemand,
  tagHealthCheckWorkflow,
  tagHealthCheckOnDemand,
} from './tag-gardening'
export { commentCorrectionWorkflow } from './comment-correction'
export {
  handleConversationSnoozed,
  handleSnoozeExpired,
} from './hold-state'
export { commentEscalationWorkflow } from './comment-escalation'
export { outboundTrackerWorkflow } from './outbound-tracker'
export { draftDeletionCheckWorkflow } from './draft-deletion-check'

import { classifyWorkflow } from './classify'
import { commentCorrectionWorkflow } from './comment-correction'
import { commentEscalationWorkflow } from './comment-escalation'
import { draftDeletionCheckWorkflow } from './draft-deletion-check'
import { draftWorkflow } from './draft-response'
import { executeApprovedAction } from './execute-approved-action'
import {
  findStaleTemplatesOnDemand,
  findStaleTemplatesWorkflow,
} from './find-stale-templates'
import { gatherWorkflow } from './gather-context'
import { handleEscalation } from './handle-escalation'
import { handleValidatedDraft } from './handle-validated-draft'
import { handleConversationSnoozed, handleSnoozeExpired } from './hold-state'
// DELETED: import { handleInboundMessage } from './handle-inbound-message'
import { indexConversation } from './index-conversation'
import { handleMemoryCitation, handleMemoryVote } from './memory-vote'
import { outboundTrackerWorkflow } from './outbound-tracker'
import { requestApproval } from './request-approval'
import { retentionCleanup } from './retention-cleanup'
import { routeWorkflow } from './route-message'
import { handleStripeEvent } from './stripe-refund'
import { syncTemplatesOnDemand, syncTemplatesWorkflow } from './sync-templates'
import {
  tagGardeningOnDemand,
  tagGardeningWorkflow,
  tagHealthCheckOnDemand,
  tagHealthCheckWorkflow,
} from './tag-gardening'
import { validateWorkflow } from './validate-draft'

/**
 * Array of all workflow functions for the Inngest serve handler.
 *
 * Usage in serve route:
 * ```typescript
 * serve({ client: inngest, functions: allWorkflows })
 * ```
 *
 * Note: Explicit type annotation needed due to TypeScript serialization limits.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const allWorkflows: any[] = [
  classifyWorkflow,
  commentCorrectionWorkflow,
  commentEscalationWorkflow,
  draftWorkflow,
  draftDeletionCheckWorkflow,
  gatherWorkflow,
  handleConversationSnoozed,
  handleEscalation,
  // DELETED: handleInboundMessage - replaced by event-driven workflows
  handleSnoozeExpired,
  handleValidatedDraft,
  requestApproval,
  executeApprovedAction,
  handleStripeEvent,
  indexConversation,
  retentionCleanup,
  handleMemoryCitation,
  handleMemoryVote,
  routeWorkflow,
  validateWorkflow,
  syncTemplatesWorkflow,
  syncTemplatesOnDemand,
  findStaleTemplatesWorkflow,
  findStaleTemplatesOnDemand,
  tagGardeningWorkflow,
  tagGardeningOnDemand,
  tagHealthCheckWorkflow,
  tagHealthCheckOnDemand,
  outboundTrackerWorkflow,
]
