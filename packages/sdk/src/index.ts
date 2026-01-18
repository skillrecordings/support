// New SupportIntegration interface (primary)
export type { SupportIntegration } from './integration';

// Core types
export type {
  User,
  Purchase,
  Subscription,
  ActionResult,
  ClaimedSeat,
} from './types';

// Deprecated exports (backwards compatibility)
export type { AppAdapter } from './adapter';
export type {
  Customer,
  RefundRequest,
  RefundResult,
} from './types';
