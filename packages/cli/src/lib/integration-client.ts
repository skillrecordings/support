import { createHmac } from 'node:crypto'

type ContentSearchRequest = {
  query: string
  types?: string[]
  limit?: number
}

type ContentSearchResult = {
  type: string
  title: string
  url?: string
  description?: string
}

type ContentSearchResponse = {
  results?: ContentSearchResult[]
}

type User = {
  id: string
  email: string
  name?: string | null
}

type Purchase = {
  id: string
  productName: string
  status: string
  amount: number | string
  currency: string
  purchasedAt: string | number | Date
}

export class IntegrationClient {
  private readonly baseUrl: string
  private readonly webhookSecret: string

  constructor(config: { baseUrl: string; webhookSecret: string }) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '')
    this.webhookSecret = config.webhookSecret
  }

  private generateSignature(body: string): string {
    const timestamp = Math.floor(Date.now() / 1000)
    const signedPayload = `${timestamp}.${body}`
    const signature = createHmac('sha256', this.webhookSecret)
      .update(signedPayload)
      .digest('hex')

    return `timestamp=${timestamp},v1=${signature}`
  }

  private async request<T>(
    action: string,
    payload: Record<string, unknown>
  ): Promise<T> {
    const body = JSON.stringify({ action, ...payload })
    const signature = this.generateSignature(body)

    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Support-Signature': signature,
      },
      body,
    })

    if (!response.ok) {
      let errorMessage: string | undefined
      try {
        const errorBody = (await response.json()) as { error?: string }
        if (errorBody?.error) {
          errorMessage = errorBody.error
        }
      } catch {
        // ignore parse errors
      }

      if (errorMessage) {
        throw new Error(errorMessage)
      }
      throw new Error(
        `Integration request failed: ${response.status} ${response.statusText}`
      )
    }

    return (await response.json()) as T
  }

  async lookupUser(email: string): Promise<User | null> {
    return this.request('lookupUser', { email })
  }

  async searchContent(
    params: ContentSearchRequest
  ): Promise<ContentSearchResponse> {
    return this.request('searchContent', params)
  }

  async getPurchases(userId: string): Promise<Purchase[]> {
    return this.request('getPurchases', { userId })
  }
}
