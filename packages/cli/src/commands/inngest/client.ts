import { z } from 'zod'

/**
 * Event schema from Inngest API
 */
export const EventSchema = z.object({
  internal_id: z.string(),
  name: z.string(),
  data: z.record(z.string(), z.unknown()).nullable(),
  received_at: z.string(),
})

export type Event = z.infer<typeof EventSchema>

/**
 * Run schema from Inngest API
 */
export const RunSchema = z.object({
  run_id: z.string(),
  function_id: z.string(),
  status: z.enum(['Running', 'Completed', 'Failed', 'Cancelled']),
  run_started_at: z.string(),
  ended_at: z.string().nullable(),
  output: z.unknown().nullable(),
  event_id: z.string().nullable(),
})

export type Run = z.infer<typeof RunSchema>

/**
 * Signal response schema
 */
export const SignalResponseSchema = z.object({
  run_id: z.string().optional(),
  message: z.string().optional(),
})

export type SignalResponse = z.infer<typeof SignalResponseSchema>

/**
 * List events parameters
 */
export interface ListEventsParams {
  name?: string
  received_after?: string
  received_before?: string
  limit?: number
  cursor?: string
}

/**
 * List events response
 */
export const ListEventsResponseSchema = z.object({
  data: z.array(EventSchema),
  cursor: z.string().optional(),
})

export type ListEventsResponse = z.infer<typeof ListEventsResponseSchema>

/**
 * Single event response (wrapped)
 * Note: data can be null if event was archived or internal
 */
export const EventResponseSchema = z.object({
  data: EventSchema.nullable(),
})

/**
 * Event runs response
 */
export const EventRunsResponseSchema = z.object({
  data: z.array(RunSchema).nullable(),
})

export type EventRunsResponse = z.infer<typeof EventRunsResponseSchema>

/**
 * Parse human-friendly time inputs to RFC3339 timestamps
 * @param input - Time string like "2h", "30m", "2d", or an RFC3339 timestamp
 * @returns RFC3339 timestamp
 *
 * @example
 * parseTimeArg("2h") // 2 hours ago
 * parseTimeArg("30m") // 30 minutes ago
 * parseTimeArg("2d") // 2 days ago
 * parseTimeArg("2024-01-15T10:00:00Z") // as-is
 */
export function parseTimeArg(input: string): string {
  const match = input.match(/^(\d+)([hmd])$/)
  if (match) {
    const [, num, unit] = match
    const msPerUnit: Record<string, number> = {
      h: 3600000,
      m: 60000,
      d: 86400000,
    }
    const ms = unit ? msPerUnit[unit] : undefined
    if (!ms || !num) {
      return input
    }
    return new Date(Date.now() - parseInt(num) * ms).toISOString()
  }
  return input // Assume RFC3339
}

/**
 * Detect if Inngest dev server is running on localhost:8288
 * @returns Promise that resolves to true if dev server is available
 */
export async function detectDevServer(): Promise<boolean> {
  try {
    const signingKey = process.env.INNGEST_SIGNING_KEY
    if (!signingKey) {
      return false
    }

    const res = await fetch('http://localhost:8288/v1/events?limit=1', {
      headers: { Authorization: `Bearer ${signingKey}` },
      signal: AbortSignal.timeout(500),
    })
    return res.ok
  } catch {
    return false
  }
}

/**
 * Typed Inngest API client
 */
export class InngestClient {
  private baseUrl: string
  private signingKey: string

  constructor(opts: { dev?: boolean } = {}) {
    const signingKey = process.env.INNGEST_SIGNING_KEY
    if (!signingKey) {
      throw new Error('INNGEST_SIGNING_KEY environment variable is required')
    }

    this.signingKey = signingKey
    this.baseUrl = opts.dev
      ? 'http://localhost:8288'
      : 'https://api.inngest.com'
  }

  /**
   * Internal fetch wrapper with auth and error handling
   */
  private async fetch<T>(path: string, opts?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...opts,
      headers: {
        Authorization: `Bearer ${this.signingKey}`,
        'Content-Type': 'application/json',
        ...opts?.headers,
      },
    })

    if (!res.ok) {
      const error = await res.json().catch(() => ({}))
      throw new Error(
        (error as { error?: string }).error || `HTTP ${res.status}`
      )
    }

    return res.json() as Promise<T>
  }

  /**
   * List recent events
   * @see https://api.inngest.com/v1/events
   */
  async listEvents(params: ListEventsParams = {}): Promise<ListEventsResponse> {
    const query = new URLSearchParams()

    if (params.name) query.set('name', params.name)
    if (params.received_after)
      query.set('received_after', params.received_after)
    if (params.received_before)
      query.set('received_before', params.received_before)
    if (params.limit) query.set('limit', params.limit.toString())
    if (params.cursor) query.set('cursor', params.cursor)

    const queryString = query.toString()
    const path = queryString ? `/v1/events?${queryString}` : '/v1/events'

    const data = await this.fetch<unknown>(path)
    return ListEventsResponseSchema.parse(data)
  }

  /**
   * Get event details by internal ID
   * @param id - Event internal_id
   */
  async getEvent(id: string): Promise<Event | null> {
    const response = await this.fetch<unknown>(`/v1/events/${id}`)
    const parsed = EventResponseSchema.parse(response)
    return parsed.data
  }

  /**
   * Get runs triggered by an event
   * @param id - Event internal_id
   */
  async getEventRuns(id: string): Promise<Run[]> {
    const response = await this.fetch<unknown>(`/v1/events/${id}/runs`)
    const parsed = EventRunsResponseSchema.parse(response)
    return parsed.data ?? []
  }

  /**
   * Get function run details
   * @param id - Run ID
   */
  async getRun(id: string): Promise<Run> {
    const response = await this.fetch<unknown>(`/v1/runs/${id}`)
    const parsed = z.object({ data: RunSchema }).parse(response)
    return parsed.data
  }

  /**
   * Cancel a running function
   * @param id - Run ID
   */
  async cancelRun(id: string): Promise<void> {
    await this.fetch<void>(`/v1/runs/${id}`, {
      method: 'DELETE',
    })
  }

  /**
   * Send a signal to resume a waiting function
   * @param signal - Signal name (e.g., "approval:draft_abc123")
   * @param data - Signal data payload
   */
  async sendSignal(signal: string, data: unknown): Promise<SignalResponse> {
    const body = JSON.stringify({ signal, data })
    const response = await this.fetch<unknown>('/v1/signals', {
      method: 'POST',
      body,
    })
    return SignalResponseSchema.parse(response)
  }

  /**
   * Replay an event by re-emitting it with the same name and data
   * @param eventId - Event internal_id to replay
   * @returns The new event ID from inn.gs
   */
  async replayEvent(
    eventId: string
  ): Promise<{ newEventId: string; event: Event }> {
    // 1. Fetch the original event
    const event = await this.getEvent(eventId)
    if (!event) {
      throw new Error(`Event ${eventId} not found or archived`)
    }
    if (!event.data) {
      throw new Error(`Event ${eventId} has no data to replay`)
    }

    // 2. Re-emit via inn.gs using event key
    const eventKey = process.env.INNGEST_EVENT_KEY
    if (!eventKey) {
      throw new Error(
        'INNGEST_EVENT_KEY environment variable is required for replay'
      )
    }

    const res = await fetch(`https://inn.gs/e/${eventKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: event.name,
        data: event.data,
      }),
    })

    if (!res.ok) {
      const error = await res.json().catch(() => ({}))
      throw new Error(
        (error as { error?: string }).error ||
          `inn.gs returned HTTP ${res.status}`
      )
    }

    const result = (await res.json()) as { ids: string[]; status: number }
    return {
      newEventId: result.ids[0] ?? 'unknown',
      event,
    }
  }
}
