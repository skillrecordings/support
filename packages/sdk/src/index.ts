/** SDK version */
export const SDK_VERSION = '0.2.2'

// New SupportIntegration interface (primary)
export type { SupportIntegration } from './integration'

// Integration client for calling app endpoints
export { IntegrationClient } from './client'

// Core types
export type {
  User,
  Purchase,
  Subscription,
  ActionResult,
  ClaimedSeat,
} from './types'

// Deprecated exports (backwards compatibility)
export type { AppAdapter } from './adapter'
export type { Customer, RefundRequest, RefundResult } from './types'
