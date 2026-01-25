/**
 * Local eval adapters for Qdrant and Ollama
 */

export { QdrantClient, createQdrantClient } from './qdrant'
export type { QdrantConfig, QdrantPoint, QdrantSearchResult } from './qdrant'

export { OllamaClient, createOllamaClient } from './ollama'
export type { OllamaConfig, OllamaEmbeddingResponse } from './ollama'
