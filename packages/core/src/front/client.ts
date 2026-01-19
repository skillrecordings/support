/**
 * Front API client for fetching conversation and message data.
 *
 * Used by Inngest workflows to hydrate webhook preview data.
 * Docs: https://dev.frontapp.com/reference
 */

import { z } from 'zod'

const FRONT_API_BASE = 'https://api2.frontapp.com'

// ============================================================================
// Zod Schemas - validate API responses at runtime
// ============================================================================

const FrontRecipientSchema = z.object({
  handle: z.string(),
  role: z.enum(['from', 'to', 'cc', 'bcc']),
  name: z.string().nullable().optional(),
  _links: z
    .object({
      related: z
        .object({
          contact: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
})

const FrontAuthorSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string().optional(),
})

const FrontMessageSchema = z.object({
  id: z.string(),
  type: z.string(),
  is_inbound: z.boolean(),
  created_at: z.number(),
  subject: z.string().optional().nullable(),
  blurb: z.string(),
  body: z.string(),
  author: FrontAuthorSchema.nullable().optional(),
  recipients: z.array(FrontRecipientSchema),
  _links: z.object({
    self: z.string(),
    related: z.object({
      conversation: z.string(),
    }),
  }),
})

const FrontConversationSchema = z.object({
  id: z.string(),
  subject: z.string(),
  status: z.enum([
    'archived',
    'unassigned',
    'assigned',
    'deleted',
    'snoozed',
    'invisible',
  ]),
  created_at: z.number(),
  recipient: z.object({
    handle: z.string(),
    role: z.string(),
  }),
  tags: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
    })
  ),
  _links: z.object({
    self: z.string(),
    related: z.object({
      messages: z.string(),
      inboxes: z.string(),
    }),
  }),
})

const FrontInboxSchema = z.object({
  id: z.string(),
  name: z.string(),
  address: z.string().optional(),
  type: z.string(),
  _links: z.object({
    self: z.string(),
  }),
})

const FrontInboxesSchema = z.object({
  _links: z.object({ self: z.string() }),
  _results: z.array(FrontInboxSchema),
})

const FrontChannelSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  address: z.string().optional(),
  type: z.string(),
  send_as: z.string().optional(),
  _links: z.object({
    self: z.string(),
    related: z
      .object({
        inbox: z.string(),
      })
      .optional(),
  }),
})

const FrontChannelsSchema = z.object({
  _links: z.object({ self: z.string() }),
  _results: z.array(FrontChannelSchema),
})

const FrontConversationMessagesSchema = z.object({
  _links: z.object({ self: z.string() }),
  _results: z.array(FrontMessageSchema),
})

// Draft creation returns a full Message object, but we only need the ID
const FrontDraftResponseSchema = z
  .object({
    id: z.string(),
  })
  .passthrough()

// ============================================================================
// Exported Types (inferred from schemas)
// ============================================================================

export type FrontMessage = z.infer<typeof FrontMessageSchema>
export type FrontConversation = z.infer<typeof FrontConversationSchema>
export type FrontInbox = z.infer<typeof FrontInboxSchema>
export type FrontInboxes = z.infer<typeof FrontInboxesSchema>
export type FrontChannel = z.infer<typeof FrontChannelSchema>
export type FrontChannels = z.infer<typeof FrontChannelsSchema>
export type FrontConversationMessages = z.infer<
  typeof FrontConversationMessagesSchema
>

/**
 * Create a Front API client with the given token.
 */
export function createFrontClient(apiToken: string) {
  const headers = {
    Authorization: `Bearer ${apiToken}`,
    'Content-Type': 'application/json',
  }

  async function fetchJson<T>(url: string, schema?: z.ZodType<T>): Promise<T> {
    const fullUrl = url.startsWith('http') ? url : `${FRONT_API_BASE}${url}`
    console.log('[front-api] GET', fullUrl)
    const startTime = Date.now()
    const response = await fetch(fullUrl, { headers })

    if (!response.ok) {
      const text = await response.text()
      console.error(
        '[front-api] GET FAILED:',
        response.status,
        response.statusText,
        text
      )
      throw new Error(
        `Front API error: ${response.status} ${response.statusText} - ${text}`
      )
    }

    const data = await response.json()
    console.log(`[front-api] GET OK (${Date.now() - startTime}ms)`)

    if (schema) {
      const parsed = schema.safeParse(data)
      if (!parsed.success) {
        console.error(
          '[front-api] Schema validation failed:',
          parsed.error.format()
        )
        console.error('[front-api] Raw data:', JSON.stringify(data, null, 2))
        throw new Error(
          `Front API schema validation failed: ${parsed.error.message}`
        )
      }
      return parsed.data
    }
    return data as T
  }

  async function postJson<T>(
    url: string,
    body: unknown,
    schema?: z.ZodType<T>
  ): Promise<T> {
    const fullUrl = url.startsWith('http') ? url : `${FRONT_API_BASE}${url}`
    console.log('[front-api] POST', fullUrl)
    console.log('[front-api] POST body:', JSON.stringify(body, null, 2))
    const startTime = Date.now()
    const response = await fetch(fullUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const text = await response.text()
      console.error(
        '[front-api] POST FAILED:',
        response.status,
        response.statusText,
        text
      )
      throw new Error(
        `Front API error: ${response.status} ${response.statusText} - ${text}`
      )
    }

    const data = await response.json()
    console.log(`[front-api] POST OK (${Date.now() - startTime}ms)`)
    console.log('[front-api] POST response:', JSON.stringify(data, null, 2))

    if (schema) {
      const parsed = schema.safeParse(data)
      if (!parsed.success) {
        console.error(
          '[front-api] Schema validation failed:',
          parsed.error.format()
        )
        console.error('[front-api] Raw data:', JSON.stringify(data, null, 2))
        throw new Error(
          `Front API schema validation failed: ${parsed.error.message}`
        )
      }
      return parsed.data
    }
    return data as T
  }

  return {
    /**
     * Get a single message by ID or URL
     */
    async getMessage(messageIdOrUrl: string): Promise<FrontMessage> {
      const url = messageIdOrUrl.startsWith('http')
        ? messageIdOrUrl
        : `/messages/${messageIdOrUrl}`
      return fetchJson(url, FrontMessageSchema)
    },

    /**
     * Get a conversation by ID or URL
     */
    async getConversation(
      conversationIdOrUrl: string
    ): Promise<FrontConversation> {
      const url = conversationIdOrUrl.startsWith('http')
        ? conversationIdOrUrl
        : `/conversations/${conversationIdOrUrl}`
      return fetchJson(url, FrontConversationSchema)
    },

    /**
     * Get all messages in a conversation
     */
    async getConversationMessages(
      conversationId: string
    ): Promise<FrontMessage[]> {
      const data = await fetchJson(
        `/conversations/${conversationId}/messages`,
        FrontConversationMessagesSchema
      )
      return data._results
    },

    /**
     * Get the inboxes associated with a conversation
     * Returns the first inbox ID (conversations typically have one inbox)
     */
    async getConversationInbox(conversationId: string): Promise<string | null> {
      const data = await fetchJson(
        `/conversations/${conversationId}/inboxes`,
        FrontInboxesSchema
      )
      return data._results[0]?.id ?? null
    },

    /**
     * Get channels for an inbox
     * Returns the first channel ID (used for creating drafts)
     */
    async getInboxChannel(inboxId: string): Promise<string | null> {
      console.log('[front-api] Getting channels for inbox:', inboxId)
      const data = await fetchJson(
        `/inboxes/${inboxId}/channels`,
        FrontChannelsSchema
      )
      console.log(
        '[front-api] Channels found:',
        data._results.map((c) => ({ id: c.id, address: c.address }))
      )
      return data._results[0]?.id ?? null
    },

    /**
     * Create a draft reply in a conversation
     * Docs: https://dev.frontapp.com/reference/create-draft
     *
     * @param conversationId - Front conversation ID
     * @param body - Draft message body
     * @param channelId - Front channel ID (cha_xxx, NOT inbox ID)
     * @param options - Optional author_id
     */
    async createDraft(
      conversationId: string,
      body: string,
      channelId: string,
      options?: { authorId?: string }
    ): Promise<z.infer<typeof FrontDraftResponseSchema>> {
      return postJson(
        `/conversations/${conversationId}/drafts`,
        {
          body,
          channel_id: channelId,
          author_id: options?.authorId,
        },
        FrontDraftResponseSchema
      )
    },

    /**
     * Send a reply to a conversation (immediately, no draft)
     * Docs: https://dev.frontapp.com/reference/reply-to-conversation
     */
    async sendReply(
      conversationId: string,
      body: string,
      options?: { authorId?: string }
    ): Promise<{ id: string }> {
      return postJson(`/conversations/${conversationId}/messages`, {
        body,
        author_id: options?.authorId,
      })
    },
  }
}

export type FrontClient = ReturnType<typeof createFrontClient>
