/**
 * TUI Types
 *
 * Local types for the review TUI that extend core types.
 */

import type {
  ReviewQueueStats,
  StoredFaqCandidate,
} from '@skillrecordings/core/faq/review'

/**
 * App configuration for multi-app switching
 */
export interface AppConfig {
  id: string
  name: string
  key: string // e.g., '1' for quick switch
}

/**
 * Known apps - map short keys to app IDs
 */
export const APPS: AppConfig[] = [
  { id: 'total-typescript', name: 'Total TypeScript', key: '1' },
  { id: 'epic-web', name: 'Epic Web', key: '2' },
  { id: 'epic-react', name: 'Epic React', key: '3' },
  { id: 'testing-javascript', name: 'Testing JavaScript', key: '4' },
  { id: 'just-javascript', name: 'Just JavaScript', key: '5' },
  { id: 'product-engineer', name: 'Product Engineer', key: '6' },
]

/**
 * TUI Application State
 */
export interface AppState {
  /** Current app being reviewed */
  currentAppId: string
  /** Candidates for current app */
  candidates: StoredFaqCandidate[]
  /** Currently selected candidate index */
  selectedIndex: number
  /** Stats for current app */
  stats: ReviewQueueStats
  /** Loading state */
  loading: boolean
  /** Error message if any */
  error: string | null
  /** Show help overlay */
  showHelp: boolean
  /** Status message (e.g., "Approved!") */
  statusMessage: string | null
}

/**
 * Actions for state management
 */
export type Action =
  | { type: 'SET_APP'; appId: string }
  | { type: 'SET_CANDIDATES'; candidates: StoredFaqCandidate[] }
  | { type: 'SET_STATS'; stats: ReviewQueueStats }
  | { type: 'SELECT_INDEX'; index: number }
  | { type: 'NEXT' }
  | { type: 'PREV' }
  | { type: 'SET_LOADING'; loading: boolean }
  | { type: 'SET_ERROR'; error: string | null }
  | { type: 'TOGGLE_HELP' }
  | { type: 'SET_STATUS'; message: string | null }
  | { type: 'REMOVE_CANDIDATE'; id: string }

export type { StoredFaqCandidate, ReviewQueueStats }
