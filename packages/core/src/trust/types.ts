/**
 * Trust scoring types for auto-send decision making
 */

export interface TrustScore {
  appId: string
  category: string
  trustScore: number
  sampleCount: number
  lastUpdatedAt: Date
  decayHalfLifeDays: number
}

export interface TrustScoreUpdate {
  trustScore: number
  sampleCount: number
}

/**
 * Categories that should never auto-send, regardless of trust score
 */
export const NEVER_AUTO_SEND_CATEGORIES = [
  'angry-customer',
  'legal',
  'team-license',
  'other',
] as const

/**
 * Trust scoring thresholds from PRD
 */
export const TRUST_THRESHOLDS = {
  /** Minimum trust score to consider auto-send */
  TRUST_SCORE: 0.85,
  /** Minimum samples needed before auto-send */
  MIN_SAMPLES: 50,
  /** Minimum confidence score to consider auto-send */
  CONFIDENCE: 0.9,
  /** Default decay half-life in days */
  DEFAULT_HALF_LIFE_DAYS: 30,
} as const
