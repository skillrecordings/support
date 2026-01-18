import { serve } from 'inngest/next'
import { inngest, allWorkflows } from '@skillrecordings/core/inngest'

// Log Inngest config on cold start (env var presence, not values)
console.log('[inngest] Config:', {
  hasSigningKey: !!process.env.INNGEST_SIGNING_KEY,
  signingKeyPrefix: process.env.INNGEST_SIGNING_KEY?.slice(0, 15),
  hasEventKey: !!process.env.INNGEST_EVENT_KEY,
  workflowCount: allWorkflows.length,
})

/**
 * Inngest serve handler for Next.js App Router.
 *
 * Enables:
 * - Inngest dev server UI (http://localhost:8288)
 * - Production webhook handling from Inngest Cloud
 * - Workflow function registration and execution
 *
 * Routes:
 * - GET: Inngest dev server introspection
 * - POST: Workflow execution from Inngest Cloud
 * - PUT: Workflow registration/updates
 */
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: allWorkflows,
})
