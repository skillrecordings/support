/**
 * Vector document metadata types
 */
export type VectorDocumentType = 'conversation' | 'knowledge' | 'response'

export type MessageCategory =
  | 'refund'
  | 'license'
  | 'access'
  | 'billing'
  | 'technical'
  | 'other'

export type Resolution = 'refund' | 'transfer' | 'info' | 'escalated'

export type CustomerSentiment = 'positive' | 'neutral' | 'negative'

export type KnowledgeSource = 'docs' | 'faq' | 'policy' | 'canned-response'

/**
 * Metadata for vector documents
 */
export interface VectorDocumentMetadata {
  type: VectorDocumentType
  appId: string
  category?: MessageCategory
  resolution?: Resolution
  customerSentiment?: CustomerSentiment
  touchCount?: number
  resolvedAt?: string
  source?: KnowledgeSource
  title?: string
  lastUpdated?: string
  trustScore?: number
  usageCount?: number
  conversationId?: string
  // Index signature for Upstash compatibility
  [key: string]: string | number | undefined
}

/**
 * Vector document structure for Upstash Vector
 */
export interface VectorDocument {
  id: string
  data: string
  metadata: VectorDocumentMetadata
}

/**
 * Query result from vector search
 */
export interface VectorQueryResult {
  id: string
  score: number
  data?: string
  metadata?: VectorDocumentMetadata
}
