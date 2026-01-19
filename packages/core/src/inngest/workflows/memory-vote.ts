/**
 * Memory voting workflow
 *
 * Handles automatic voting on memories based on resolution outcomes.
 * Votes are applied to all cited memories to reinforce or penalize
 * their use in future agent responses.
 */

import { VotingService } from '@skillrecordings/memory/voting'
import { inngest } from '../client'
import { MEMORY_VOTE_REQUESTED } from '../events'

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

      for (const memoryId of cited_memories) {
        await VotingService.recordOutcome(memoryId, collection, outcomeType)
      }

      return {
        recorded: cited_memories.length,
        outcome: outcomeType,
      }
    })

    // Apply automatic votes based on outcome
    await step.run('apply-votes', async () => {
      const voteType = outcome === 'success' ? 'upvote' : 'downvote'

      for (const memoryId of cited_memories) {
        await VotingService.vote(memoryId, collection, voteType)
      }

      return {
        voted: cited_memories.length,
        voteType,
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
