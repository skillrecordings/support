/**
 * Memory voting workflow
 *
 * Handles automatic voting on memories based on resolution outcomes.
 * Votes are applied to all cited memories to reinforce or penalize
 * their use in future agent responses.
 */

import { VotingService } from '@skillrecordings/memory/voting'
import {
  traceMemoryCite,
  traceMemoryOutcome,
  traceMemoryVote,
} from '../../observability/axiom'
import { inngest } from '../client'
import {
  MEMORY_CITED,
  MEMORY_VOTE_REQUESTED,
  type MemoryCitedEvent,
} from '../events'

/**
 * Memory Vote Workflow
 *
 * Listens for memory/vote.requested events and applies automatic votes
 * based on resolution outcome:
 * - success → upvote all cited memories
 * - failure → downvote all cited memories
 * - rejection → downvote all cited memories (indicates poor quality)
 */
export const handleMemoryVote = inngest.createFunction(
  {
    id: 'memory-vote',
    name: 'Handle Memory Voting',
  },
  { event: MEMORY_VOTE_REQUESTED },
  async ({ event, step }) => {
    const { run_id, outcome, cited_memories, collection } = event.data

    // Record outcomes for all cited memories
    await step.run('record-outcomes', async () => {
      const outcomeType = outcome === 'success' ? 'success' : 'failure'
      const startTime = Date.now()

      try {
        // Use batch signature: recordOutcome(memoryIds, runId, outcome, collection)
        await VotingService.recordOutcome(
          cited_memories,
          run_id,
          outcomeType,
          collection
        )

        // Trace successful outcome recording
        await traceMemoryOutcome({
          memoryId: cited_memories.join(','),
          collection,
          outcome: outcomeType,
          conversationId: run_id,
          previousSuccessRate: 0, // Not available in this context
          newSuccessRate: 0, // Not available in this context
          totalOutcomes: cited_memories.length,
          durationMs: Date.now() - startTime,
          success: true,
        })

        return {
          recorded: cited_memories.length,
          outcome: outcomeType,
        }
      } catch (error) {
        // Trace failed outcome recording
        await traceMemoryOutcome({
          memoryId: cited_memories.join(','),
          collection,
          outcome: outcomeType,
          conversationId: run_id,
          previousSuccessRate: 0,
          newSuccessRate: 0,
          totalOutcomes: cited_memories.length,
          durationMs: Date.now() - startTime,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        })
        throw error
      }
    })

    // Apply automatic votes based on outcome
    await step.run('apply-votes', async () => {
      const voteType = outcome === 'success' ? 'upvote' : 'downvote'
      const startTime = Date.now()

      try {
        for (const memoryId of cited_memories) {
          const voteStartTime = Date.now()
          await VotingService.vote(memoryId, collection, voteType)

          // Trace each vote
          await traceMemoryVote({
            memoryId,
            collection,
            voteType,
            previousUpvotes: 0, // Not available in this context
            previousDownvotes: 0,
            newUpvotes: voteType === 'upvote' ? 1 : 0,
            newDownvotes: voteType === 'downvote' ? 1 : 0,
            durationMs: Date.now() - voteStartTime,
            success: true,
          })
        }

        return {
          voted: cited_memories.length,
          voteType,
        }
      } catch (error) {
        await traceMemoryVote({
          memoryId: cited_memories.join(','),
          collection,
          voteType,
          previousUpvotes: 0,
          previousDownvotes: 0,
          newUpvotes: 0,
          newDownvotes: 0,
          durationMs: Date.now() - startTime,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        })
        throw error
      }
    })

    return {
      run_id,
      outcome,
      processed_memories: cited_memories.length,
      collection,
    }
  }
)

/**
 * Memory Citation Handler
 *
 * Listens for memory/cited events and records citation counts
 * for memories used during agent execution.
 */
export const handleMemoryCitation = inngest.createFunction(
  {
    id: 'memory-citation',
    name: 'Handle Memory Citation',
  },
  { event: MEMORY_CITED },
  async ({ event, step }) => {
    const { memoryIds, runId, conversationId, collection } = event.data

    await step.run('record-citations', async () => {
      const startTime = Date.now()

      try {
        // Use batch signature: cite(memoryIds, runId, collection)
        await VotingService.cite(memoryIds, runId, collection)

        // Trace successful citation recording
        await traceMemoryCite({
          memoryId: memoryIds.join(','),
          collection,
          conversationId,
          appId: event.data.appId,
          previousCitations: 0, // Not available in this context
          newCitations: memoryIds.length,
          durationMs: Date.now() - startTime,
          success: true,
        })

        return {
          cited: memoryIds.length,
          runId,
          conversationId,
        }
      } catch (error) {
        // Trace failed citation recording
        await traceMemoryCite({
          memoryId: memoryIds.join(','),
          collection,
          conversationId,
          appId: event.data.appId,
          previousCitations: 0,
          newCitations: 0,
          durationMs: Date.now() - startTime,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        })
        throw error
      }
    })

    return {
      runId,
      processed_memories: memoryIds.length,
      collection,
      conversationId,
    }
  }
)
