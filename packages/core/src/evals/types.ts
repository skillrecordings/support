import type { RouteType } from '../router/types'

/**
 * Single evaluation datapoint for routing evaluation.
 */
export interface EvalDatapoint {
  /** Input message to route */
  message: string
  /** Expected category (e.g., 'refund', 'account', 'support') */
  expectedCategory: string
  /** Expected route type */
  expectedRoute: RouteType
}

/**
 * Per-category metrics breakdown.
 */
export interface CategoryMetrics {
  /** True positives for this category */
  tp: number
  /** False positives for this category */
  fp: number
  /** False negatives for this category */
  fn: number
  /** True negatives for this category */
  tn: number
  /** Precision: TP / (TP + FP) */
  precision: number
  /** Recall: TP / (TP + FN) */
  recall: number
  /** F1 score: 2 * (precision * recall) / (precision + recall) */
  f1: number
  /** Number of samples for this category */
  count: number
}

/**
 * Cost tracking for evaluation run.
 */
export interface CostMetrics {
  /** Total tokens consumed */
  tokens: number
  /** Estimated cost in USD */
  estimatedUsd: number
}

/**
 * Latency percentiles in milliseconds.
 */
export interface LatencyMetrics {
  /** 50th percentile (median) */
  p50: number
  /** 95th percentile */
  p95: number
  /** 99th percentile */
  p99: number
}

/**
 * Complete evaluation report with metrics and gate status.
 */
export interface EvalReport {
  /** Overall precision across all categories */
  precision: number
  /** Overall recall across all categories */
  recall: number
  /** False positive rate: FP / (FP + TN) */
  fpRate: number
  /** False negative rate: FN / (FN + TP) */
  fnRate: number
  /** Per-category breakdown */
  byCategory: Record<string, CategoryMetrics>
  /** Cost metrics */
  cost: CostMetrics
  /** Latency metrics */
  latency: LatencyMetrics
  /** Whether all gates passed */
  passed: boolean
}

/**
 * Optional regression gates for evaluation.
 * Any metric below threshold causes the evaluation to fail.
 */
export interface EvalGates {
  /** Minimum precision (default: 0.92) */
  minPrecision?: number
  /** Minimum recall (default: 0.95) */
  minRecall?: number
  /** Maximum false positive rate (default: 0.03) */
  maxFpRate?: number
  /** Maximum false negative rate (default: 0.02) */
  maxFnRate?: number
}
