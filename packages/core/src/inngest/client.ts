import { Inngest, EventSchemas } from 'inngest'
import type { Events } from './events'

/**
 * Inngest client for the support platform.
 *
 * Configured with id 'support-platform' and typed events.
 * Event key is pulled from INNGEST_EVENT_KEY env var.
 *
 * Usage:
 * ```typescript
 * inngest.send({
 *   name: 'support/inbound.received',
 *   data: { conversationId, appId, senderEmail, messageId, body }
 * })
 * ```
 */
export const inngest = new Inngest({
  id: 'support-platform',
  schemas: new EventSchemas().fromRecord<Events>(),
})
