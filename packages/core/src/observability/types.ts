/**
 * Observability types for Axiom tracing
 */

export interface TraceAttributes {
  conversationId?: string
  appId?: string
  traceId?: string
  userId?: string
  [key: string]: string | number | boolean | undefined
}

export interface InstrumentedHandler<TEvent = unknown, TResult = unknown> {
  (event: TEvent): Promise<TResult>
}

export interface InstrumentedTool<TArgs = unknown, TResult = unknown> {
  (args: TArgs): Promise<TResult>
}

export interface TraceSpan {
  name: string
  startTime: number
  endTime?: number
  attributes: TraceAttributes
  status: 'success' | 'error'
  error?: Error
}
