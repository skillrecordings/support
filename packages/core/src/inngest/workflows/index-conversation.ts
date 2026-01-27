import { createHash } from 'node:crypto'
import { updateTrustScore } from '../../trust/score'
import { getVectorIndex, upsertVector } from '../../vector/client'
import { redactPII } from '../../vector/redact'
import type { VectorDocument } from '../../vector/types'
import { inngest } from '../client'
import { SUPPORT_CONVERSATION_RESOLVED } from '../events'

/**
 * Generate deterministic document ID from conversation ID
 */
function generateDocumentId(conversationId: string): string {
  return createHash('sha256').update(conversationId).digest('hex').slice(0, 16)
}

/**
 * Index a resolved conversation into vector storage.
 *
 * Steps:
 * 1. Redact PII from all message content
 * 2. Build vector document with metadata
 * 3. Upsert to vector index
 * 4. Update trust score if auto-sent
 *
 * SUPPORT_CONVERSATION_RESOLVED is emitted by execute-approved-action workflow
 * after a draft is successfully created in Front. The payload includes the full
 * conversation message history, customer email, and resolution metadata.
 *
 * This workflow indexes resolved conversations into the vector store for
 * knowledge base enrichment and future RAG retrieval.
 *
 * See: docs/epic-chain-prd.md (Epic 4), memory/epic1-data-flow-audit.md (Boundary 10)
 */
export const indexConversation = inngest.createFunction(
  {
    id: 'index-conversation',
    throttle: {
      key: 'event.data.conversationId',
      limit: 1,
      period: '10s',
    },
  },
  { event: SUPPORT_CONVERSATION_RESOLVED },
  async ({ event, step }) => {
    const { conversationId, appId, customerEmail, messages, resolution } =
      event.data

    // Step 1: Redact PII from all message content
    const redactedMessages = await step.run('redact-pii', async () => {
      return messages.map((msg) => ({
        ...msg,
        content: redactPII(msg.content, [customerEmail]),
      }))
    })

    // Step 2: Build vector document
    const document = await step.run('build-document', async () => {
      // Combine all messages into searchable text
      const data = redactedMessages
        .map((msg) => `[${msg.role}]: ${msg.content}`)
        .join('\n\n')

      const doc: VectorDocument = {
        id: generateDocumentId(conversationId),
        data,
        metadata: {
          type: 'conversation',
          appId,
          conversationId,
          category: resolution.category as any,
          resolution: 'info', // Default resolution type
          touchCount: redactedMessages.filter((m) => m.role === 'agent').length,
          resolvedAt: new Date().toISOString(),
          trustScore: resolution.trustScore,
        },
      }

      return doc
    })

    // Step 3: Upsert to vector index
    await step.run('upsert-vector', async () => {
      // Ensure vector index is initialized
      getVectorIndex()
      return upsertVector(document)
    })

    // Step 4: Update trust score if auto-sent
    if (resolution.wasAutoSent && resolution.trustScore !== undefined) {
      await step.run('update-trust', async () => {
        // Trust score update logic would typically involve database writes
        // For now, we just call the function to validate the pattern
        return updateTrustScore(resolution.trustScore || 0, 1, true)
      })
    }

    return {
      success: true,
      conversationId,
      documentId: document.id,
    }
  }
)
