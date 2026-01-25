/**
 * Ollama adapter for local embeddings in eval environment
 * Provides embeddings without external API calls
 */

export interface OllamaConfig {
  baseUrl: string
  model: string
}

export interface OllamaEmbeddingResponse {
  embedding: number[]
}

/**
 * Ollama client for local embeddings
 */
export class OllamaClient {
  private baseUrl: string
  private model: string

  constructor(config: OllamaConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '')
    this.model = config.model
  }

  /**
   * Generate embeddings for text
   */
  async embed(text: string): Promise<number[]> {
    const res = await fetch(`${this.baseUrl}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        input: text,
      }),
    })

    if (!res.ok) {
      const error = await res.text()
      throw new Error(`Failed to generate embedding: ${error}`)
    }

    const data = (await res.json()) as {
      embeddings?: number[][]
      embedding?: number[]
    }

    // Ollama returns embeddings array for batch, single embedding for single input
    if (data.embeddings && data.embeddings.length > 0) {
      return data.embeddings[0]!
    }

    if (data.embedding) {
      return data.embedding
    }

    throw new Error('No embedding returned from Ollama')
  }

  /**
   * Generate embeddings for multiple texts
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    const embeddings: number[][] = []

    // Ollama doesn't support true batch embedding, so we process sequentially
    for (const text of texts) {
      const embedding = await this.embed(text)
      embeddings.push(embedding)
    }

    return embeddings
  }

  /**
   * Check if model is available
   */
  async isModelAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`)
      if (!res.ok) return false

      const data = (await res.json()) as { models?: { name: string }[] }
      const models = data.models || []

      return models.some(
        (m) => m.name === this.model || m.name.startsWith(`${this.model}:`)
      )
    } catch {
      return false
    }
  }

  /**
   * Pull model if not available
   */
  async ensureModel(): Promise<void> {
    const available = await this.isModelAvailable()
    if (available) return

    console.log(`Pulling Ollama model: ${this.model}...`)

    const res = await fetch(`${this.baseUrl}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: this.model }),
    })

    if (!res.ok) {
      const error = await res.text()
      throw new Error(`Failed to pull model: ${error}`)
    }

    // Stream the response to show progress
    const reader = res.body?.getReader()
    if (reader) {
      const decoder = new TextDecoder()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const text = decoder.decode(value)
        const lines = text.split('\n').filter(Boolean)
        for (const line of lines) {
          try {
            const data = JSON.parse(line)
            if (data.status) {
              process.stdout.write(`\r${data.status}`)
            }
          } catch {
            // Ignore parse errors
          }
        }
      }
      console.log('\nModel pulled successfully')
    }
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`)
      return res.ok
    } catch {
      return false
    }
  }
}

/**
 * Create Ollama client from environment
 */
export function createOllamaClient(): OllamaClient {
  const baseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434'
  const model = process.env.EMBEDDING_MODEL || 'nomic-embed-text'

  return new OllamaClient({ baseUrl, model })
}
