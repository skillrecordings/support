/**
 * Front API module
 *
 * Provides client for interacting with Front's API to fetch
 * conversations, messages, and other data.
 */

export { createFrontClient } from './client'
export type { FrontClient, FrontMessage, FrontConversation } from './client'
export { markdownToHtml } from './markdown'
