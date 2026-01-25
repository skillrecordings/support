/**
 * GET /api/analytics/learning
 *
 * Returns learning curve metrics for the agent dashboard.
 * Tracks correction rates per pipeline stage over time.
 *
 * Query params:
 * - appId: Required. App identifier (e.g., 'total-typescript')
 * - stage: Optional. Filter to specific stage ('classify', 'route', 'draft', etc.)
 * - days: Optional. Number of days to look back (default: 30)
 * - groupBy: Optional. 'day' or 'week' (default: 'day')
 * - includeRepeats: Optional. Include repeat corrections analysis
 */

import {
  type LearningCurveSummary,
  type RepeatCorrection,
  type StageMetrics,
  getLearningCurve,
  getLearningCurveSummary,
  getRepeatCorrections,
} from '@skillrecordings/core/analytics/learning-curves'
import type { SupportStage } from '@skillrecordings/memory/support-schemas'
import { NextRequest, NextResponse } from 'next/server'

/**
 * API response shape
 */
interface LearningAnalyticsResponse {
  success: boolean
  data?: {
    summary: LearningCurveSummary
    metrics: StageMetrics[]
    repeatCorrections?: RepeatCorrection[]
  }
  error?: string
}

export async function GET(
  request: NextRequest
): Promise<NextResponse<LearningAnalyticsResponse>> {
  try {
    const searchParams = request.nextUrl.searchParams

    // Required: appId
    const appId = searchParams.get('appId')
    if (!appId) {
      return NextResponse.json(
        { success: false, error: 'appId query parameter is required' },
        { status: 400 }
      )
    }

    // Optional params
    const stage = searchParams.get('stage') as SupportStage | null
    const days = parseInt(searchParams.get('days') ?? '30', 10)
    const groupBy = (searchParams.get('groupBy') ?? 'day') as 'day' | 'week'
    const includeRepeats = searchParams.get('includeRepeats') === 'true'

    // Validate stage if provided
    const validStages = ['classify', 'route', 'gather', 'draft', 'validate']
    if (stage && !validStages.includes(stage)) {
      return NextResponse.json(
        {
          success: false,
          error: `Invalid stage. Must be one of: ${validStages.join(', ')}`,
        },
        { status: 400 }
      )
    }

    // Validate days
    if (isNaN(days) || days < 1 || days > 365) {
      return NextResponse.json(
        { success: false, error: 'days must be between 1 and 365' },
        { status: 400 }
      )
    }

    // Validate groupBy
    if (groupBy !== 'day' && groupBy !== 'week') {
      return NextResponse.json(
        { success: false, error: 'groupBy must be "day" or "week"' },
        { status: 400 }
      )
    }

    // Fetch learning curve data
    const [metrics, summary] = await Promise.all([
      getLearningCurve({
        appId,
        stage: stage ?? undefined,
        days,
        groupBy,
      }),
      getLearningCurveSummary(appId, days),
    ])

    // Optionally fetch repeat corrections
    let repeatCorrections: RepeatCorrection[] | undefined
    if (includeRepeats) {
      repeatCorrections = await getRepeatCorrections({
        appId,
        minCount: 2,
        limit: 20,
      })
    }

    return NextResponse.json({
      success: true,
      data: {
        summary,
        metrics,
        repeatCorrections,
      },
    })
  } catch (error) {
    console.error('[/api/analytics/learning] Error:', error)

    const message =
      error instanceof Error ? error.message : 'Internal server error'

    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    )
  }
}
