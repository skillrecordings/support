/**
 * Forensic Query Toolkit for Agent Self-Diagnosis
 *
 * Canned queries that agents use to trace pipelines, measure step timings,
 * detect errors, verify data flow, and check overall system health.
 *
 * Usage:
 *   skill axiom pipeline-trace <conversationId> [--since 7d]
 *   skill axiom step-timings [--since 7d]
 *   skill axiom error-rate [--since 7d]
 *   skill axiom data-flow-check [--since 7d]
 *   skill axiom tag-health [--since 7d]
 *   skill axiom approval-stats [--since 7d]
 *   skill axiom pipeline-health [--since 7d]
 */

import { Axiom } from '@axiomhq/js'
import type { Command } from 'commander'

// ---------------------------------------------------------------------------
// Shared helpers (mirror the patterns in index.ts)
// ---------------------------------------------------------------------------

function getDataset(): string {
  return process.env.AXIOM_DATASET || 'support-agent'
}

function getAxiomClient(): Axiom {
  const token = process.env.AXIOM_TOKEN
  if (!token) {
    console.error('AXIOM_TOKEN environment variable is required')
    process.exit(1)
  }
  return new Axiom({ token })
}

function parseTimeRange(since: string): { startTime: Date; endTime: Date } {
  const endTime = new Date()
  const match = since.match(/^(\d+)([hmd])$/)
  if (match && match[1] && match[2]) {
    const value = parseInt(match[1], 10)
    const unit = match[2] as 'h' | 'm' | 'd'
    const msPerUnit: Record<'h' | 'm' | 'd', number> = {
      h: 60 * 60 * 1000,
      m: 60 * 1000,
      d: 24 * 60 * 60 * 1000,
    }
    return {
      startTime: new Date(endTime.getTime() - value * msPerUnit[unit]),
      endTime,
    }
  }
  const startTime = new Date(since)
  if (isNaN(startTime.getTime())) {
    console.error(
      `Invalid time range: ${since}. Use format like "1h", "24h", "7d" or ISO date.`
    )
    process.exit(1)
  }
  return { startTime, endTime }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${(ms / 60000).toFixed(1)}m`
}

function formatTime(timestamp: string | Date): string {
  const date = new Date(timestamp)
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyBucket = any

/** Safely extract a numeric aggregation value from an Axiom bucket */
function aggVal(bucket: AnyBucket, index: number): number {
  const aggs = bucket?.aggregations as Array<{ value: unknown }> | undefined
  return Number(aggs?.[index]?.value ?? 0)
}

/** Safely extract a group field from an Axiom bucket */
function groupVal(bucket: AnyBucket, field: string): string {
  const group = bucket?.group as Record<string, string> | undefined
  return group?.[field] ?? ''
}

// ---------------------------------------------------------------------------
// 1. pipeline-trace — Full trace for a single conversation
// ---------------------------------------------------------------------------

async function pipelineTrace(
  conversationId: string,
  options: { since?: string; json?: boolean }
): Promise<void> {
  const client = getAxiomClient()
  const ds = getDataset()
  const { startTime, endTime } = parseTimeRange(options.since ?? '7d')
  const timeOpts = {
    startTime: startTime.toISOString(),
    endTime: endTime.toISOString(),
  }

  const baseProjection =
    '_time, name, step, level, message, category, confidence, durationMs, tagged'
  const baseQuery = `['${ds}'] | where conversationId == '${conversationId}' | sort by _time asc`

  // traceId may not exist yet (T0.3 adds it). Try with it, fall back without.
  let result
  try {
    result = await client.query(
      `${baseQuery} | project ${baseProjection}, traceId`,
      timeOpts
    )
  } catch {
    result = await client.query(
      `${baseQuery} | project ${baseProjection}`,
      timeOpts
    )
  }

  try {
    const matches = result.matches ?? []

    if (options.json) {
      console.log(
        JSON.stringify(
          matches.map((m) => ({ _time: m._time, ...(m.data as object) })),
          null,
          2
        )
      )
      return
    }

    if (matches.length === 0) {
      console.log(`No events found for conversation: ${conversationId}`)
      return
    }

    console.log(`\n🔍 Pipeline Trace: ${conversationId}`)
    console.log(
      `   Events: ${matches.length} | Window: ${options.since ?? '7d'}`
    )
    console.log('═'.repeat(90))

    for (const match of matches) {
      const d = match.data as Record<string, unknown>
      const time = formatTime(match._time)
      const name = String(d.name ?? '—')
      const step = d.step ? ` [${d.step}]` : ''
      const level = d.level ? ` ${String(d.level).toUpperCase()}` : ''
      const dur = d.durationMs ? ` ${formatDuration(Number(d.durationMs))}` : ''
      const cat = d.category ? ` cat=${d.category}` : ''
      const conf = d.confidence != null ? ` conf=${d.confidence}` : ''
      const tag = d.tagged != null ? ` tagged=${d.tagged}` : ''
      const trace = d.traceId ? ` trace=${d.traceId}` : ''

      console.log(
        `  ${time}  ${name}${step}${level}${dur}${cat}${conf}${tag}${trace}`
      )
      if (d.message) {
        console.log(`           ${String(d.message).slice(0, 120)}`)
      }
    }

    console.log('─'.repeat(90))
    console.log(`Total: ${matches.length} events`)
  } catch (error) {
    console.error(
      'Query failed:',
      error instanceof Error ? error.message : error
    )
    process.exit(1)
  }
}

// ---------------------------------------------------------------------------
// 2. step-timings — P50/P95 duration by step name
// ---------------------------------------------------------------------------

async function stepTimings(options: {
  since?: string
  json?: boolean
}): Promise<void> {
  const client = getAxiomClient()
  const ds = getDataset()
  const { startTime, endTime } = parseTimeRange(options.since ?? '7d')

  const apl = `['${ds}']
| where isnotnull(durationMs) and durationMs > 0
| summarize p50=percentile(durationMs, 50), p95=percentile(durationMs, 95), avg=avg(durationMs), count=count() by name
| sort by p95 desc`

  try {
    const result = await client.query(apl, {
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
    })

    const buckets = result.buckets?.totals ?? []

    if (options.json) {
      console.log(
        JSON.stringify(
          buckets.map((b) => ({
            name: groupVal(b, 'name'),
            p50: aggVal(b, 0),
            p95: aggVal(b, 1),
            avg: aggVal(b, 2),
            count: aggVal(b, 3),
          })),
          null,
          2
        )
      )
      return
    }

    if (buckets.length === 0) {
      console.log('No timing data found')
      return
    }

    console.log(`\n⏱  Step Timings (${options.since ?? '7d'})`)
    console.log('═'.repeat(90))
    console.log(
      `${'Step'.padEnd(30)} ${'P50'.padStart(10)} ${'P95'.padStart(10)} ${'Avg'.padStart(10)} ${'Count'.padStart(8)}`
    )
    console.log('─'.repeat(90))

    for (const bucket of buckets) {
      const name = groupVal(bucket, 'name') || '—'
      const p50 = formatDuration(aggVal(bucket, 0))
      const p95 = formatDuration(aggVal(bucket, 1))
      const avg = formatDuration(aggVal(bucket, 2))
      const count = String(aggVal(bucket, 3))

      console.log(
        `${name.padEnd(30)} ${p50.padStart(10)} ${p95.padStart(10)} ${avg.padStart(10)} ${count.padStart(8)}`
      )
    }

    console.log('─'.repeat(90))
  } catch (error) {
    console.error(
      'Query failed:',
      error instanceof Error ? error.message : error
    )
    process.exit(1)
  }
}

// ---------------------------------------------------------------------------
// 3. error-rate — Failure rate by step over time window
// ---------------------------------------------------------------------------

async function errorRate(options: {
  since?: string
  json?: boolean
}): Promise<void> {
  const client = getAxiomClient()
  const ds = getDataset()
  const { startTime, endTime } = parseTimeRange(options.since ?? '7d')

  // Note: Using extend + where after summarize causes Axiom to return results
  // in matches (not buckets.totals), so we read from matches.
  const apl = `['${ds}']
| summarize errors=countif(level == 'error' or success == false), total=count() by name
| extend rate=errors * 100.0 / total
| where errors > 0
| sort by rate desc`

  try {
    const result = await client.query(apl, {
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
    })

    const matches = result.matches ?? []

    if (options.json) {
      console.log(
        JSON.stringify(
          matches.map((m) => {
            const d = m.data as Record<string, unknown>
            return {
              name: d.name ?? '—',
              errors: Number(d.errors ?? 0),
              total: Number(d.total ?? 0),
              rate: Number(Number(d.rate ?? 0).toFixed(2)),
            }
          }),
          null,
          2
        )
      )
      return
    }

    if (matches.length === 0) {
      console.log('No errors found — pipeline is clean 🎉')
      return
    }

    console.log(`\n🚨 Error Rate by Step (${options.since ?? '7d'})`)
    console.log('═'.repeat(80))
    console.log(
      `${'Step'.padEnd(30)} ${'Errors'.padStart(8)} ${'Total'.padStart(8)} ${'Rate'.padStart(8)}`
    )
    console.log('─'.repeat(80))

    for (const match of matches) {
      const d = match.data as Record<string, unknown>
      const name = String(d.name ?? '—')
      const errors = Number(d.errors ?? 0)
      const total = Number(d.total ?? 0)
      const rate = Number(d.rate ?? 0)

      const indicator = rate > 10 ? '🔴' : rate > 5 ? '🟡' : '🟢'
      console.log(
        `${indicator} ${name.padEnd(28)} ${String(errors).padStart(8)} ${String(total).padStart(8)} ${rate.toFixed(1).padStart(7)}%`
      )
    }

    console.log('─'.repeat(80))
  } catch (error) {
    console.error(
      'Query failed:',
      error instanceof Error ? error.message : error
    )
    process.exit(1)
  }
}

// ---------------------------------------------------------------------------
// 4. data-flow-check — Verify field presence at each boundary
// ---------------------------------------------------------------------------

async function dataFlowCheck(options: {
  since?: string
  json?: boolean
}): Promise<void> {
  const client = getAxiomClient()
  const ds = getDataset()
  const { startTime, endTime } = parseTimeRange(options.since ?? '7d')
  const timeOpts = {
    startTime: startTime.toISOString(),
    endTime: endTime.toISOString(),
  }

  // traceId may not exist yet (T0.3 is adding it). Try with it, fall back without.
  const baseFields =
    'hasConversationId=countif(isnotnull(conversationId)), hasAppId=countif(isnotnull(appId)), hasMessageId=countif(isnotnull(messageId)), hasStep=countif(isnotnull(step))'
  const withTraceId = `${baseFields}, hasTraceId=countif(isnotnull(traceId)), total=count()`
  const withoutTraceId = `${baseFields}, total=count()`

  let hasTraceIdField = true

  // traceId may not exist yet (T0.3 adds it). Try with it, fall back without.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function runDataFlowQuery(): Promise<any> {
    try {
      return await client.query(
        `['${ds}'] | where name contains 'workflow' or name == 'log' | summarize ${withTraceId} by name`,
        timeOpts
      )
    } catch {
      hasTraceIdField = false
      return await client.query(
        `['${ds}'] | where name contains 'workflow' or name == 'log' | summarize ${withoutTraceId} by name`,
        timeOpts
      )
    }
  }

  try {
    const result = await runDataFlowQuery()
    const buckets = result.buckets?.totals ?? []

    // Field indices shift depending on whether traceId is present
    const totalIdx = hasTraceIdField ? 5 : 4
    const fieldNames = hasTraceIdField
      ? ['convId', 'appId', 'msgId', 'step', 'traceId']
      : ['convId', 'appId', 'msgId', 'step']
    if (options.json) {
      console.log(
        JSON.stringify(
          buckets.map((b: AnyBucket) => {
            const total = aggVal(b, totalIdx)
            const entry: Record<string, unknown> = {
              name: groupVal(b, 'name'),
              conversationId: {
                present: aggVal(b, 0),
                pct: total ? Math.round((aggVal(b, 0) * 100) / total) : 0,
              },
              appId: {
                present: aggVal(b, 1),
                pct: total ? Math.round((aggVal(b, 1) * 100) / total) : 0,
              },
              messageId: {
                present: aggVal(b, 2),
                pct: total ? Math.round((aggVal(b, 2) * 100) / total) : 0,
              },
              step: {
                present: aggVal(b, 3),
                pct: total ? Math.round((aggVal(b, 3) * 100) / total) : 0,
              },
              total,
            }
            if (hasTraceIdField) {
              entry.traceId = {
                present: aggVal(b, 4),
                pct: total ? Math.round((aggVal(b, 4) * 100) / total) : 0,
              }
            }
            return entry
          }),
          null,
          2
        )
      )
      return
    }

    if (buckets.length === 0) {
      console.log('No workflow/log events found')
      return
    }

    const headerFields = fieldNames.map((f) => f.padStart(8)).join(' ')
    const lineWidth = 28 + fieldNames.length * 9 + 9

    console.log(`\n🔗 Data Flow Check (${options.since ?? '7d'})`)
    if (!hasTraceIdField)
      console.log('   ⚠ traceId field not yet in schema (T0.3 pending)')
    console.log('═'.repeat(lineWidth))
    console.log(`${'Step'.padEnd(28)} ${headerFields} ${'total'.padStart(8)}`)
    console.log('─'.repeat(lineWidth))

    for (const bucket of buckets) {
      const name = groupVal(bucket, 'name') || '—'
      const total = aggVal(bucket, totalIdx)
      const fields = fieldNames.map((_, i) => {
        const count = aggVal(bucket, i)
        const pct = total ? Math.round((count * 100) / total) : 0
        const indicator =
          pct === 100 ? '✓' : pct > 80 ? '~' : pct === 0 ? '✗' : '!'
        return `${indicator}${String(pct).padStart(3)}%`
      })

      console.log(
        `${name.padEnd(28)} ${fields.map((f) => f.padStart(8)).join(' ')} ${String(total).padStart(8)}`
      )
    }

    console.log('─'.repeat(lineWidth))
    console.log('Legend: ✓=100% | ~=>80% | !=partial | ✗=0%')
  } catch (error) {
    console.error(
      'Query failed:',
      error instanceof Error ? error.message : error
    )
    process.exit(1)
  }
}

// ---------------------------------------------------------------------------
// 5. tag-health — Tag application success/failure breakdown
// ---------------------------------------------------------------------------

async function tagHealth(options: {
  since?: string
  json?: boolean
}): Promise<void> {
  const client = getAxiomClient()
  const ds = getDataset()
  const { startTime, endTime } = parseTimeRange(options.since ?? '7d')

  // Note: The spec suggested grouping by errorType, but that field doesn't exist
  // in the dataset. We group by appId + name instead (which separates log events
  // from workflow.step events for richer diagnostics).
  const apl = `['${ds}']
| where step == 'apply-tag' or name contains 'tag'
| summarize success=countif(tagged == true), failure=countif(tagged == false), total=count() by appId, name`

  try {
    const result = await client.query(apl, {
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
    })

    const buckets = result.buckets?.totals ?? []

    if (options.json) {
      console.log(
        JSON.stringify(
          buckets.map((b) => ({
            appId: groupVal(b, 'appId'),
            name: groupVal(b, 'name'),
            success: aggVal(b, 0),
            failure: aggVal(b, 1),
            total: aggVal(b, 2),
            successRate: aggVal(b, 2)
              ? Number(((aggVal(b, 0) * 100) / aggVal(b, 2)).toFixed(1))
              : 0,
          })),
          null,
          2
        )
      )
      return
    }

    if (buckets.length === 0) {
      console.log('No tagging events found')
      return
    }

    console.log(`\n🏷  Tag Health (${options.since ?? '7d'})`)
    console.log('═'.repeat(90))
    console.log(
      `${'App'.padEnd(25)} ${'Event'.padEnd(25)} ${'OK'.padStart(6)} ${'Fail'.padStart(6)} ${'Total'.padStart(6)} ${'Rate'.padStart(8)}`
    )
    console.log('─'.repeat(90))

    for (const bucket of buckets) {
      const appId = groupVal(bucket, 'appId') || '—'
      const name = groupVal(bucket, 'name') || '—'
      const success = aggVal(bucket, 0)
      const failure = aggVal(bucket, 1)
      const total = aggVal(bucket, 2)
      const rate = total ? ((success * 100) / total).toFixed(1) : '—'

      const indicator =
        Number(rate) >= 95 ? '🟢' : Number(rate) >= 80 ? '🟡' : '🔴'
      console.log(
        `${indicator} ${appId.padEnd(23)} ${name.padEnd(25)} ${String(success).padStart(6)} ${String(failure).padStart(6)} ${String(total).padStart(6)} ${String(rate).padStart(7)}%`
      )
    }

    console.log('─'.repeat(90))
  } catch (error) {
    console.error(
      'Query failed:',
      error instanceof Error ? error.message : error
    )
    process.exit(1)
  }
}

// ---------------------------------------------------------------------------
// 6. approval-stats — Auto-approval vs manual review breakdown
// ---------------------------------------------------------------------------

async function approvalStats(options: {
  since?: string
  json?: boolean
}): Promise<void> {
  const client = getAxiomClient()
  const ds = getDataset()
  const { startTime, endTime } = parseTimeRange(options.since ?? '7d')

  const apl = `['${ds}']
| where name == 'log' and (message contains 'auto-approv' or message contains 'approval')
| summarize auto=countif(autoApprove == true), manual=countif(autoApprove == false), total=count() by appId`

  try {
    const result = await client.query(apl, {
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
    })

    const buckets = result.buckets?.totals ?? []

    if (options.json) {
      console.log(
        JSON.stringify(
          buckets.map((b) => {
            const total = aggVal(b, 2)
            return {
              appId: groupVal(b, 'appId'),
              auto: aggVal(b, 0),
              manual: aggVal(b, 1),
              total,
              autoRate: total
                ? Number(((aggVal(b, 0) * 100) / total).toFixed(1))
                : 0,
            }
          }),
          null,
          2
        )
      )
      return
    }

    if (buckets.length === 0) {
      console.log('No approval events found')
      return
    }

    console.log(`\n✅ Approval Stats (${options.since ?? '7d'})`)
    console.log('═'.repeat(70))
    console.log(
      `${'App'.padEnd(30)} ${'Auto'.padStart(8)} ${'Manual'.padStart(8)} ${'Total'.padStart(8)} ${'Auto %'.padStart(8)}`
    )
    console.log('─'.repeat(70))

    for (const bucket of buckets) {
      const appId = groupVal(bucket, 'appId') || '—'
      const auto = aggVal(bucket, 0)
      const manual = aggVal(bucket, 1)
      const total = aggVal(bucket, 2)
      const autoRate = total ? ((auto * 100) / total).toFixed(1) : '—'

      console.log(
        `${appId.padEnd(30)} ${String(auto).padStart(8)} ${String(manual).padStart(8)} ${String(total).padStart(8)} ${String(autoRate).padStart(7)}%`
      )
    }

    console.log('─'.repeat(70))
  } catch (error) {
    console.error(
      'Query failed:',
      error instanceof Error ? error.message : error
    )
    process.exit(1)
  }
}

// ---------------------------------------------------------------------------
// 7. pipeline-health — Overall pipeline health dashboard
// ---------------------------------------------------------------------------

async function pipelineHealth(options: {
  since?: string
  json?: boolean
}): Promise<void> {
  const client = getAxiomClient()
  const ds = getDataset()
  const { startTime, endTime } = parseTimeRange(options.since ?? '7d')

  const timeOpts = {
    startTime: startTime.toISOString(),
    endTime: endTime.toISOString(),
  }

  try {
    // Run all sub-queries in parallel
    const [
      totalResult,
      errorResult,
      timingResult,
      tagResult,
      approvalResult,
      topErrorsResult,
    ] = await Promise.all([
      // Total messages processed
      client.query(
        `['${ds}'] | where name == 'agent.run' | summarize total=count()`,
        timeOpts
      ),
      // Error count and rate
      client.query(
        `['${ds}'] | summarize errors=countif(level == 'error' or success == false), total=count()`,
        timeOpts
      ),
      // Average pipeline duration (from agent.run which has durationMs)
      client.query(
        `['${ds}'] | where name == 'agent.run' and isnotnull(durationMs) and durationMs > 0 | summarize avg=avg(durationMs), p50=percentile(durationMs, 50), p95=percentile(durationMs, 95)`,
        timeOpts
      ),
      // Tag success rate
      client.query(
        `['${ds}'] | where step == 'apply-tag' or name contains 'tag' | summarize success=countif(tagged == true), total=count()`,
        timeOpts
      ),
      // Auto-approval rate
      client.query(
        `['${ds}'] | where name == 'log' and (message contains 'auto-approv' or message contains 'approval') | summarize auto=countif(autoApprove == true), total=count()`,
        timeOpts
      ),
      // Top error categories
      client.query(
        `['${ds}'] | where level == 'error' or success == false | summarize count=count() by name | sort by count desc | limit 5`,
        timeOpts
      ),
    ])

    // Extract values safely
    const totalProcessed = aggVal(
      (totalResult.buckets?.totals?.[0] ?? {}) as Record<string, unknown>,
      0
    )

    const errorBucket = (errorResult.buckets?.totals?.[0] ?? {}) as Record<
      string,
      unknown
    >
    const totalErrors = aggVal(errorBucket, 0)
    const totalEvents = aggVal(errorBucket, 1)
    const overallErrorRate = totalEvents ? (totalErrors * 100) / totalEvents : 0

    const timingBucket = (timingResult.buckets?.totals?.[0] ?? {}) as Record<
      string,
      unknown
    >
    const avgDuration = aggVal(timingBucket, 0)
    const p50Duration = aggVal(timingBucket, 1)
    const p95Duration = aggVal(timingBucket, 2)

    const tagBucket = (tagResult.buckets?.totals?.[0] ?? {}) as Record<
      string,
      unknown
    >
    const tagSuccess = aggVal(tagBucket, 0)
    const tagTotal = aggVal(tagBucket, 1)
    const tagRate = tagTotal ? (tagSuccess * 100) / tagTotal : 0

    const approvalBucket = (approvalResult.buckets?.totals?.[0] ??
      {}) as Record<string, unknown>
    const autoApproval = aggVal(approvalBucket, 0)
    const approvalTotal = aggVal(approvalBucket, 1)
    const autoRate = approvalTotal ? (autoApproval * 100) / approvalTotal : 0

    const topErrors = (topErrorsResult.buckets?.totals ?? []).map((b) => ({
      name: groupVal(b, 'name'),
      count: aggVal(b, 0),
    }))

    const dashboard = {
      window: options.since ?? '7d',
      totalProcessed,
      totalEvents,
      errors: { count: totalErrors, rate: Number(overallErrorRate.toFixed(2)) },
      duration: {
        avg: Math.round(avgDuration),
        p50: Math.round(p50Duration),
        p95: Math.round(p95Duration),
      },
      tags: {
        success: tagSuccess,
        total: tagTotal,
        rate: Number(tagRate.toFixed(1)),
      },
      approval: {
        auto: autoApproval,
        total: approvalTotal,
        rate: Number(autoRate.toFixed(1)),
      },
      topErrors,
    }

    if (options.json) {
      console.log(JSON.stringify(dashboard, null, 2))
      return
    }

    // Pretty dashboard
    const statusIcon =
      overallErrorRate > 5 ? '🔴' : overallErrorRate > 2 ? '🟡' : '🟢'

    console.log(
      `\n${statusIcon} Pipeline Health Dashboard (${options.since ?? '7d'})`
    )
    console.log('═'.repeat(60))
    console.log()
    console.log(`  📬 Messages processed:  ${totalProcessed}`)
    console.log(`  📊 Total events:        ${totalEvents}`)
    console.log()
    console.log(
      `  🚨 Error rate:          ${overallErrorRate.toFixed(2)}% (${totalErrors} errors)`
    )
    console.log()
    console.log(`  ⏱  Pipeline duration:`)
    console.log(`     Avg:  ${formatDuration(avgDuration)}`)
    console.log(`     P50:  ${formatDuration(p50Duration)}`)
    console.log(`     P95:  ${formatDuration(p95Duration)}`)
    console.log()
    console.log(
      `  🏷  Tag success rate:    ${tagRate.toFixed(1)}% (${tagSuccess}/${tagTotal})`
    )
    console.log(
      `  ✅ Auto-approval rate:  ${autoRate.toFixed(1)}% (${autoApproval}/${approvalTotal})`
    )

    if (topErrors.length > 0) {
      console.log()
      console.log('  🔥 Top Error Sources:')
      for (const e of topErrors) {
        console.log(`     ${String(e.count).padStart(5)}  ${e.name}`)
      }
    }

    console.log()
    console.log('─'.repeat(60))
  } catch (error) {
    console.error(
      'Query failed:',
      error instanceof Error ? error.message : error
    )
    process.exit(1)
  }
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerForensicCommands(axiom: Command): void {
  axiom
    .command('pipeline-trace')
    .description('Full trace for a single conversation (pipeline debugging)')
    .argument('<conversationId>', 'Conversation ID to trace')
    .option('-s, --since <time>', 'Time range (e.g., 1h, 24h, 7d)', '7d')
    .option('--json', 'Output as JSON')
    .action(pipelineTrace)

  axiom
    .command('step-timings')
    .description('P50/P95 duration by step name')
    .option('-s, --since <time>', 'Time range (e.g., 1h, 24h, 7d)', '7d')
    .option('--json', 'Output as JSON')
    .action(stepTimings)

  axiom
    .command('error-rate')
    .description('Failure rate by step over time window')
    .option('-s, --since <time>', 'Time range (e.g., 1h, 24h, 7d)', '7d')
    .option('--json', 'Output as JSON')
    .action(errorRate)

  axiom
    .command('data-flow-check')
    .description('Verify field presence at each pipeline boundary')
    .option('-s, --since <time>', 'Time range (e.g., 1h, 24h, 7d)', '7d')
    .option('--json', 'Output as JSON')
    .action(dataFlowCheck)

  axiom
    .command('tag-health')
    .description('Tag application success/failure breakdown')
    .option('-s, --since <time>', 'Time range (e.g., 1h, 24h, 7d)', '7d')
    .option('--json', 'Output as JSON')
    .action(tagHealth)

  axiom
    .command('approval-stats')
    .description('Auto-approval vs manual review breakdown')
    .option('-s, --since <time>', 'Time range (e.g., 1h, 24h, 7d)', '7d')
    .option('--json', 'Output as JSON')
    .action(approvalStats)

  axiom
    .command('pipeline-health')
    .description('Overall pipeline health dashboard (agent-readable)')
    .option('-s, --since <time>', 'Time range (e.g., 1h, 24h, 7d)', '7d')
    .option('--json', 'Output as JSON')
    .action(pipelineHealth)
}
