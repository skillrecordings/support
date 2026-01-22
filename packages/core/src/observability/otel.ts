/**
 * OpenTelemetry + Langfuse integration for AI SDK tracing
 *
 * This captures telemetry spans from the Vercel AI SDK and sends them to Langfuse
 * for LLM observability including token usage, latency, and cost tracking.
 *
 * Usage:
 * 1. Call initializeOtel() at app startup (before any AI SDK calls)
 * 2. Pass experimental_telemetry: { isEnabled: true } to AI SDK functions
 *
 * @see https://langfuse.com/docs/integrations/opentelemetry
 */

import { LangfuseSpanProcessor } from '@langfuse/otel'
import { NodeSDK } from '@opentelemetry/sdk-node'

let sdk: NodeSDK | null = null
let initialized = false

/**
 * Initialize OpenTelemetry with Langfuse span processor.
 *
 * Should be called once at app startup. Safe to call multiple times
 * (subsequent calls are no-ops).
 *
 * Required env vars:
 * - LANGFUSE_PUBLIC_KEY
 * - LANGFUSE_SECRET_KEY
 * - LANGFUSE_HOST (optional, defaults to cloud.langfuse.com)
 */
export function initializeOtel(): void {
  if (initialized) {
    return
  }

  const publicKey = process.env.LANGFUSE_PUBLIC_KEY
  const secretKey = process.env.LANGFUSE_SECRET_KEY

  if (!publicKey || !secretKey) {
    console.warn(
      '[OTel] LANGFUSE_PUBLIC_KEY or LANGFUSE_SECRET_KEY not set, AI SDK telemetry disabled'
    )
    initialized = true
    return
  }

  try {
    sdk = new NodeSDK({
      spanProcessors: [new LangfuseSpanProcessor()],
    })

    sdk.start()
    initialized = true
    console.log('[OTel] OpenTelemetry + Langfuse initialized')
  } catch (error) {
    console.error('[OTel] Failed to initialize:', error)
    initialized = true // Mark as initialized to prevent retry loops
  }
}

/**
 * Shutdown OpenTelemetry gracefully.
 * Call this before process exit to flush pending spans.
 */
export async function shutdownOtel(): Promise<void> {
  if (sdk) {
    await sdk.shutdown()
    sdk = null
    initialized = false
    console.log('[OTel] OpenTelemetry shutdown complete')
  }
}

/**
 * Telemetry config for AI SDK calls.
 * Pass this to generateText/generateObject/streamText etc.
 */
export const telemetryConfig = {
  isEnabled: true,
} as const
