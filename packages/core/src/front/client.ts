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
    const response = await fetch(fullUrl, { headers })

    if (!response.ok) {
      throw new Error(`Front API error: ${response.status} ${response.statusText}`)
    }

    return response.json()
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
    async getConversation(conversationIdOrUrl: string): Promise<FrontConversation> {
      const url = conversationIdOrUrl.startsWith('http')
        ? conversationIdOrUrl
        : `/conversations/${conversationIdOrUrl}`
      return fetchJson<FrontConversation>(url)
    },

    /**
     * Get all messages in a conversation
     */
    async getConversationMessages(conversationId: string): Promise<FrontMessage[]> {
      const data = await fetchJson<FrontConversationMessages>(
        `/conversations/${conversationId}/messages`
      )
      return data._results
    },
  }
}

export type FrontClient = ReturnType<typeof createFrontClient>
