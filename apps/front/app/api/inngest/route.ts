import { serve } from 'inngest/next'
import { inngest, allWorkflows } from '@skillrecordings/core/inngest'

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
