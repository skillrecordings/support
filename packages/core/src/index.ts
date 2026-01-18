/**
 * @skillrecordings/core
 *
 * Core exports for the support platform. Prefer package.json exports
 * for tree-shaking: import { foo } from '@skillrecordings/core/agent'
 */

/** Package version, injected at build time */
export const VERSION = '0.0.0'

// Agent
export { runSupportAgent } from './agent/config'

// Tools (from existing tools module)
export { supportTools, createTool } from './tools'

// Inngest (from existing inngest module)
export {
  inngest as inngestClient,
  createServeHandler,
  allWorkflows,
} from './inngest'

// Observability
export {
  withTracing,
  instrumentWebhook,
  instrumentTool,
  initializeAxiom,
} from './observability/axiom'

// Middleware
export { createRateLimiter, rateLimitMiddleware } from './middleware/rate-limit'

// Services
export { RETENTION_DEFAULTS, cleanupExpiredData } from './services/retention'

// Trust (direct imports, no barrel)
export { recordOutcome } from './trust/feedback'
export {
  shouldAutoSend,
  calculateTrustScore,
  updateTrustScore,
} from './trust/score'
export { getTrustScore, upsertTrustScore } from './trust/repository'
export { TRUST_THRESHOLDS, NEVER_AUTO_SEND_CATEGORIES } from './trust/types'
export type { TrustScore, TrustScoreUpdate } from './trust/types'

// Router (direct imports, no barrel)
export { matchCannedResponse, interpolateTemplate } from './router/canned'
export {
  classifyMessage,
  type ClassifierCategory,
  type ClassifierResult,
} from './router/classifier'
export {
  routeMessage,
  type RouterDecision,
  type RoutingContext,
} from './router/message-router'
export { RouterCache } from './router/cache'

// Evals
export {
  evalRouting,
  type EvalDatapoint,
  type EvalGates,
  type EvalReport,
  type CategoryMetrics,
} from './evals/routing'
