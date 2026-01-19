/**
 * Front API client for fetching conversation and message data.
 *
 * Used by Inngest workflows to hydrate webhook preview data.
 * Docs: https://dev.frontapp.com/reference
 */

const FRONT_API_BASE = 'https://api2.frontapp.com'

export interface FrontMessage {
  id: string
  type: string
  is_inbound: boolean
  created_at: number
  subject?: string
  blurb: string
  body: string
  author?: {
    id: string
    email: string
    name?: string
  }
  recipients: Array<{
    handle: string
    role: 'from' | 'to' | 'cc' | 'bcc'
  }>
  _links: {
    self: string
    related: {
      conversation: string
    }
  }
}

export interface FrontConversation {
  id: string
  subject: string
  status: 'archived' | 'unassigned' | 'assigned' | 'deleted' | 'snoozed'
  created_at: number
  recipient: {
    handle: string
    role: string
  }
  tags: Array<{
    id: string
    name: string
  }>
  _links: {
    self: string
    related: {
      messages: string
      inboxes: string
    }
  }
}

export interface FrontInbox {
  id: string
  name: string
  address: string
  type: string
  _links: {
    self: string
  }
}

export interface FrontInboxes {
  _links: {
    self: string
  }
  _results: FrontInbox[]
}

export interface FrontChannel {
  id: string
  name: string
  address: string
  type: string
  send_as: string
  _links: {
    self: string
    related: {
      inbox: string
    }
  }
}

export interface FrontChannels {
  _links: {
    self: string
  }
  _results: FrontChannel[]
}

export interface FrontConversationMessages {
  _links: {
    self: string
  }
  _results: FrontMessage[]
}

/**
 * Create a Front API client with the given token.
 */
export function createFrontClient(apiToken: string) {
  const headers = {
    Authorization: `Bearer ${apiToken}`,
    'Content-Type': 'application/json',
  }

  async function fetchJson<T>(url: string): Promise<T> {
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
    return data
  }

  async function postJson<T>(url: string, body: unknown): Promise<T> {
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
    return data
  }

  return {
    /**
     * Get a single message by ID or URL
     */
    async getMessage(messageIdOrUrl: string): Promise<FrontMessage> {
      const url = messageIdOrUrl.startsWith('http')
        ? messageIdOrUrl
        : `/messages/${messageIdOrUrl}`
      return fetchJson<FrontMessage>(url)
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
      return fetchJson<FrontConversation>(url)
    },

    /**
     * Get all messages in a conversation
     */
    async getConversationMessages(
      conversationId: string
    ): Promise<FrontMessage[]> {
      const data = await fetchJson<FrontConversationMessages>(
        `/conversations/${conversationId}/messages`
      )
      return data._results
    },

    /**
     * Get the inboxes associated with a conversation
     * Returns the first inbox ID (conversations typically have one inbox)
     */
    async getConversationInbox(conversationId: string): Promise<string | null> {
      const data = await fetchJson<FrontInboxes>(
        `/conversations/${conversationId}/inboxes`
      )
      return data._results[0]?.id ?? null
    },

    /**
     * Get channels for an inbox
     * Returns the first channel ID (used for creating drafts)
     */
    async getInboxChannel(inboxId: string): Promise<string | null> {
      console.log('[front-api] Getting channels for inbox:', inboxId)
      const data = await fetchJson<FrontChannels>(
        `/inboxes/${inboxId}/channels`
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
     * @param channelId - Front channel/inbox ID (required by Front API)
     * @param options - Optional author_id
     */
    async createDraft(
      conversationId: string,
      body: string,
      channelId: string,
      options?: { authorId?: string }
    ): Promise<{ id: string; conversation_id: string }> {
      return postJson(`/conversations/${conversationId}/drafts`, {
        body,
        channel_id: channelId,
        author_id: options?.authorId,
      })
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
