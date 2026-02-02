/**
 * GitHub Event Handlers
 *
 * Processes webhook events from the Grimlock GitHub App.
 *
 * Current handlers:
 * - handleAgentReadyLabel: Notifies Slack when `agent/ready` label is added
 * - handleIssueComment: Logs comments for learning/feedback tracking
 * - handlePrReview: Tracks PR review outcomes
 */

import { log } from '../../observability/axiom'
import { postMessage } from '../../slack/client'
import { inngest } from '../client'
import {
  GITHUB_ISSUE_COMMENT,
  GITHUB_ISSUE_LABELED,
  GITHUB_PR_REVIEW,
} from '../events'

/**
 * Handle `agent/ready` label being added to an issue.
 *
 * When an issue is labeled with `agent/ready`, this workflow:
 * 1. Notifies the Slack channel
 * 2. Could auto-claim and spawn a worker (future enhancement)
 */
export const handleAgentReadyLabel = inngest.createFunction(
  {
    id: 'github-agent-ready-label',
    name: 'Handle Agent Ready Label',
  },
  { event: GITHUB_ISSUE_LABELED },
  async ({ event, step }) => {
    const { action, label, issue, repository, sender } = event.data

    // Only handle when agent/ready label is added
    if (action !== 'labeled' || label !== 'agent/ready') {
      return { skipped: true, reason: 'Not agent/ready label addition' }
    }

    await log('info', 'agent/ready label added to issue', {
      component: 'github-events',
      repo: repository.fullName,
      issueNumber: issue.number,
      issueTitle: issue.title,
      labeledBy: sender,
    })

    // Notify Slack
    const slackChannel = process.env.SLACK_GITHUB_CHANNEL
    if (slackChannel) {
      await step.run('notify-slack', async () => {
        const message = [
          `🤖 *New agent/ready issue*`,
          ``,
          `<${issue.htmlUrl}|#${issue.number}: ${issue.title}>`,
          `Repo: \`${repository.fullName}\``,
          `Labeled by: @${sender}`,
        ].join('\n')

        await postMessage(slackChannel, { text: message })

        await log('info', 'Slack notification sent for agent/ready issue', {
          component: 'github-events',
          channel: slackChannel,
          issueNumber: issue.number,
        })
      })
    }

    return {
      processed: true,
      repo: repository.fullName,
      issue: issue.number,
    }
  }
)

/**
 * Handle comments on GitHub issues.
 *
 * Tracks comments for:
 * - Human feedback on agent work
 * - Corrections and learnings
 * - Discussion context
 */
export const handleIssueComment = inngest.createFunction(
  {
    id: 'github-issue-comment',
    name: 'Handle Issue Comment',
  },
  { event: GITHUB_ISSUE_COMMENT },
  async ({ event }) => {
    const { action, comment, issue, repository, sender } = event.data

    // Only process new comments (not edits or deletes)
    if (action !== 'created') {
      return { skipped: true, reason: `Comment action: ${action}` }
    }

    // Skip bot comments (including Grimlock)
    if (sender.endsWith('[bot]') || sender === 'grimlockbot') {
      return { skipped: true, reason: 'Bot comment' }
    }

    await log('info', 'GitHub issue comment received', {
      component: 'github-events',
      repo: repository.fullName,
      issueNumber: issue.number,
      commentId: comment.id,
      commenter: sender,
      bodyPreview: comment.body.slice(0, 100),
    })

    // Future: Extract feedback, corrections, learnings from comments
    // Future: Store in hivemind for agent learning

    return {
      processed: true,
      repo: repository.fullName,
      issue: issue.number,
      comment: comment.id,
    }
  }
)

/**
 * Handle PR reviews.
 *
 * Tracks review outcomes for:
 * - Agent PR quality metrics
 * - Learning from rejections
 * - Approval patterns
 */
export const handlePrReview = inngest.createFunction(
  {
    id: 'github-pr-review',
    name: 'Handle PR Review',
  },
  { event: GITHUB_PR_REVIEW },
  async ({ event }) => {
    const { action, review, pullRequest, repository, sender } = event.data

    // Only process submitted reviews
    if (action !== 'submitted') {
      return { skipped: true, reason: `Review action: ${action}` }
    }

    await log('info', 'GitHub PR review received', {
      component: 'github-events',
      repo: repository.fullName,
      prNumber: pullRequest.number,
      reviewId: review.id,
      reviewer: sender,
      state: review.state,
    })

    // Future: Track approval/rejection rates for agent PRs
    // Future: Extract feedback from changes_requested reviews
    // Future: Update hivemind with learnings

    return {
      processed: true,
      repo: repository.fullName,
      pr: pullRequest.number,
      review: review.id,
      state: review.state,
    }
  }
)

/**
 * All GitHub event handlers.
 * Import this in workflows/index.ts to register them.
 */
export const githubEventHandlers = [
  handleAgentReadyLabel,
  handleIssueComment,
  handlePrReview,
]
