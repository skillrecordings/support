/**
 * Production Clusterer
 *
 * Generates production-ready clustering output from Phase 0 artifacts.
 * Uses validated HDBSCAN parameters from Phase 0 discovery.
 *
 * @module faq/production-clusterer
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type {
  ConversationAssignment,
  Phase0Assignment,
  Phase0ClusterLabel,
  ProductionCluster,
  ProductionClusterOptions,
  ProductionClusteringResult,
} from './types'

/**
 * Phase 0 metrics.json structure
 */
interface Phase0Metrics {
  algorithm: string
  parameters: {
    min_cluster_size: number
    min_samples: number
  }
  num_clusters: number
  noise_points: number
  silhouette_score: number
  noise_pct: number
  largest_cluster_pct: number
  cluster_sizes: Record<string, number>
  dimensionality_reduction: {
    method: string
    original_dims: number
    reduced_dims: number
    variance_explained: number
  }
  created_at: string
}

/**
 * Read and parse Phase 0 assignments
 */
function readPhase0Assignments(
  phase0Path: string
): Record<string, Phase0Assignment> {
  const assignmentsPath = join(phase0Path, 'clusters/v1/assignments.json')
  if (!existsSync(assignmentsPath)) {
    // Try latest symlink
    const latestPath = join(phase0Path, 'clusters/latest/assignments.json')
    if (!existsSync(latestPath)) {
      throw new Error(`Phase 0 assignments not found at ${assignmentsPath}`)
    }
    const content = readFileSync(latestPath, 'utf-8')
    return JSON.parse(content)
  }
  const content = readFileSync(assignmentsPath, 'utf-8')
  return JSON.parse(content)
}

/**
 * Read and parse Phase 0 labels
 */
function readPhase0Labels(phase0Path: string): Phase0ClusterLabel[] {
  const labelsPath = join(phase0Path, 'clusters/v1/labels.json')
  if (!existsSync(labelsPath)) {
    const latestPath = join(phase0Path, 'clusters/latest/labels.json')
    if (!existsSync(latestPath)) {
      throw new Error(`Phase 0 labels not found at ${labelsPath}`)
    }
    const content = readFileSync(latestPath, 'utf-8')
    const parsed = JSON.parse(content)
    return parsed.clusters || []
  }
  const content = readFileSync(labelsPath, 'utf-8')
  const parsed = JSON.parse(content)
  return parsed.clusters || []
}

/**
 * Read Phase 0 metrics
 */
function readPhase0Metrics(phase0Path: string): Phase0Metrics {
  const metricsPath = join(phase0Path, 'clusters/v1/metrics.json')
  if (!existsSync(metricsPath)) {
    const latestPath = join(phase0Path, 'clusters/latest/metrics.json')
    if (!existsSync(latestPath)) {
      throw new Error(`Phase 0 metrics not found at ${metricsPath}`)
    }
    return JSON.parse(readFileSync(latestPath, 'utf-8'))
  }
  return JSON.parse(readFileSync(metricsPath, 'utf-8'))
}

/**
 * Calculate confidence from distance to centroid
 * Lower distance = higher confidence
 */
function calculateConfidence(distance: number | null): number {
  if (distance === null) return 0
  // Normalize: distances typically range 0-1 for cosine distance
  // Use exponential decay for smoother confidence curve
  return Math.exp(-distance * 2)
}

/**
 * Tier assignments from Phase 0 decisions
 */
const TIER_1_LABELS = [
  'email transfer',
  'magic link',
  'login',
  'invoice',
  'receipt',
]
const TIER_2_LABELS = ['refund', 'access', 'ppp', 'purchasing power']
const TIER_3_LABELS = [
  'student',
  'discount',
  'certificate',
  'video',
  'team plan',
]

/**
 * Determine priority tier from cluster label
 */
function getPriorityTier(label: string): number | undefined {
  const lowerLabel = label.toLowerCase()
  if (TIER_1_LABELS.some((t) => lowerLabel.includes(t))) return 1
  if (TIER_2_LABELS.some((t) => lowerLabel.includes(t))) return 2
  if (TIER_3_LABELS.some((t) => lowerLabel.includes(t))) return 3
  return undefined
}

/**
 * Generate production clustering from Phase 0 artifacts
 */
export async function generateProductionClustering(
  options: ProductionClusterOptions
): Promise<ProductionClusteringResult> {
  const { phase0Path, outputPath, version = 'v1' } = options

  console.log('📊 Reading Phase 0 artifacts...')
  const assignments = readPhase0Assignments(phase0Path)
  const labels = readPhase0Labels(phase0Path)
  const metrics = readPhase0Metrics(phase0Path)

  console.log(
    `   Found ${Object.keys(assignments).length} conversation assignments`
  )
  console.log(`   Found ${labels.length} cluster labels`)
  console.log(`   Algorithm: ${metrics.algorithm}`)

  // Build cluster metadata map
  const labelMap = new Map<number, Phase0ClusterLabel>()
  for (const label of labels) {
    labelMap.set(label.id, label)
  }

  // Calculate per-cluster stats
  const clusterStats = new Map<
    number,
    { distances: number[]; conversationIds: string[] }
  >()

  for (const [convId, assignment] of Object.entries(assignments)) {
    const clusterId = assignment.cluster_id
    if (!clusterStats.has(clusterId)) {
      clusterStats.set(clusterId, { distances: [], conversationIds: [] })
    }
    const stats = clusterStats.get(clusterId)!
    stats.conversationIds.push(convId)
    if (assignment.distance_to_centroid !== null) {
      stats.distances.push(assignment.distance_to_centroid)
    }
  }

  // Build production clusters
  const productionClusters: ProductionCluster[] = []
  let clusteredCount = 0
  let noiseCount = 0

  for (const [clusterId, stats] of clusterStats.entries()) {
    if (clusterId === -1) {
      noiseCount = stats.conversationIds.length
      continue
    }

    clusteredCount += stats.conversationIds.length
    const label = labelMap.get(clusterId)

    const avgDistance =
      stats.distances.length > 0
        ? stats.distances.reduce((a, b) => a + b, 0) / stats.distances.length
        : 0

    // Get representative IDs (first 5 closest to centroid)
    const sortedByDistance = stats.conversationIds
      .map((id) => ({
        id,
        distance: assignments[id]?.distance_to_centroid ?? Infinity,
      }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 5)
      .map((x) => x.id)

    productionClusters.push({
      id: clusterId,
      label: label?.label ?? `Cluster ${clusterId}`,
      size: stats.conversationIds.length,
      representativeIds: sortedByDistance,
      topTags: label?.top_existing_tags ?? [],
      tagCoverage: label?.tag_coverage ?? 0,
      avgDistanceToCentroid: avgDistance,
      priorityTier: label ? getPriorityTier(label.label) : undefined,
    })
  }

  // Sort clusters by size (largest first)
  productionClusters.sort((a, b) => b.size - a.size)

  // Build assignments map
  const productionAssignments: Record<string, ConversationAssignment> = {}
  for (const [convId, assignment] of Object.entries(assignments)) {
    productionAssignments[convId] = {
      conversationId: convId,
      clusterId: assignment.cluster_id,
      distanceToCentroid: assignment.distance_to_centroid,
      confidence: calculateConfidence(assignment.distance_to_centroid),
    }
  }

  const totalConversations = Object.keys(assignments).length

  const result: ProductionClusteringResult = {
    version,
    generatedAt: new Date().toISOString(),
    config: {
      algorithm: metrics.algorithm,
      parameters: metrics.parameters,
      phase0ArtifactPath: phase0Path,
    },
    stats: {
      totalConversations,
      clusteredConversations: clusteredCount,
      noiseConversations: noiseCount,
      clusterCount: productionClusters.length,
      noisePct: (noiseCount / totalConversations) * 100,
      largestClusterSize: productionClusters[0]?.size ?? 0,
      avgClusterSize:
        productionClusters.length > 0
          ? clusteredCount / productionClusters.length
          : 0,
    },
    clusters: productionClusters,
    assignments: productionAssignments,
  }

  return result
}

/**
 * Write production clustering artifacts to disk
 */
export function writeProductionArtifacts(
  result: ProductionClusteringResult,
  outputPath: string
): void {
  const versionPath = join(outputPath, result.version)

  // Create output directory
  if (!existsSync(versionPath)) {
    mkdirSync(versionPath, { recursive: true })
  }

  // Write main result file
  const resultPath = join(versionPath, 'clustering-result.json')
  writeFileSync(resultPath, JSON.stringify(result, null, 2))
  console.log(`✅ Written: ${resultPath}`)

  // Write assignments separately (for efficient lookup)
  const assignmentsPath = join(versionPath, 'assignments.json')
  writeFileSync(assignmentsPath, JSON.stringify(result.assignments, null, 2))
  console.log(`✅ Written: ${assignmentsPath}`)

  // Write cluster metadata separately
  const clustersPath = join(versionPath, 'clusters.json')
  writeFileSync(
    clustersPath,
    JSON.stringify(
      {
        version: result.version,
        generatedAt: result.generatedAt,
        stats: result.stats,
        clusters: result.clusters,
      },
      null,
      2
    )
  )
  console.log(`✅ Written: ${clustersPath}`)

  // Write summary for quick reference
  const summaryPath = join(versionPath, 'summary.json')
  const summary = {
    version: result.version,
    generatedAt: result.generatedAt,
    stats: result.stats,
    topClusters: result.clusters.slice(0, 20).map((c) => ({
      id: c.id,
      label: c.label,
      size: c.size,
      priorityTier: c.priorityTier,
    })),
  }
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2))
  console.log(`✅ Written: ${summaryPath}`)

  // Update latest symlink (via copy for cross-platform compat)
  const latestPath = join(outputPath, 'latest')
  if (existsSync(latestPath)) {
    // Remove existing latest
    const { rmSync } = require('fs')
    rmSync(latestPath, { recursive: true, force: true })
  }
  mkdirSync(latestPath, { recursive: true })

  // Copy files to latest
  for (const file of [
    'clustering-result.json',
    'assignments.json',
    'clusters.json',
    'summary.json',
  ]) {
    const src = join(versionPath, file)
    const dst = join(latestPath, file)
    writeFileSync(dst, readFileSync(src))
  }
  console.log(`✅ Updated: ${latestPath}`)
}

/**
 * Display clustering summary to console
 */
export function displayClusteringSummary(
  result: ProductionClusteringResult
): void {
  console.log('\n📊 Production Clustering Summary')
  console.log('='.repeat(60))
  console.log(`   Version: ${result.version}`)
  console.log(`   Generated: ${result.generatedAt}`)
  console.log(`   Algorithm: ${result.config.algorithm}`)
  console.log('')
  console.log('📈 Statistics:')
  console.log(
    `   Total conversations:     ${result.stats.totalConversations.toLocaleString()}`
  )
  console.log(
    `   Clustered:               ${result.stats.clusteredConversations.toLocaleString()}`
  )
  console.log(
    `   Noise (unclustered):     ${result.stats.noiseConversations.toLocaleString()} (${result.stats.noisePct.toFixed(1)}%)`
  )
  console.log(`   Cluster count:           ${result.stats.clusterCount}`)
  console.log(`   Largest cluster:         ${result.stats.largestClusterSize}`)
  console.log(
    `   Average cluster size:    ${result.stats.avgClusterSize.toFixed(1)}`
  )

  console.log('\n🏆 Top 15 Clusters:')
  console.log('-'.repeat(60))
  for (const cluster of result.clusters.slice(0, 15)) {
    const tierStr = cluster.priorityTier
      ? ` [Tier ${cluster.priorityTier}]`
      : ''
    console.log(
      `   #${cluster.id.toString().padStart(2)} ${cluster.label.slice(0, 40).padEnd(40)} ${cluster.size.toString().padStart(5)}${tierStr}`
    )
  }

  // Show tier breakdown
  const tier1 = result.clusters.filter((c) => c.priorityTier === 1)
  const tier2 = result.clusters.filter((c) => c.priorityTier === 2)
  const tier3 = result.clusters.filter((c) => c.priorityTier === 3)

  console.log('\n🎯 Priority Tiers:')
  console.log(
    `   Tier 1 (Critical):   ${tier1.length} clusters, ${tier1.reduce((a, c) => a + c.size, 0)} conversations`
  )
  console.log(
    `   Tier 2 (High):       ${tier2.length} clusters, ${tier2.reduce((a, c) => a + c.size, 0)} conversations`
  )
  console.log(
    `   Tier 3 (Normal):     ${tier3.length} clusters, ${tier3.reduce((a, c) => a + c.size, 0)} conversations`
  )
  console.log('')
}
