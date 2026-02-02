/**
 * GitHub Webhooks API endpoint
 *
 * Receives webhook events from the Grimlock GitHub App.
 * Verifies signatures and emits Inngest events for processing.
 *
 * Events handled:
 * - issue_comment: Comments on issues (human feedback, corrections)
 * - pull_request_review: PR reviews (approvals, changes requested)
 * - issues: Issue state changes (opened, closed, labeled)
 *
 * @see https://docs.github.com/en/webhooks/webhook-events-and-payloads
 */

import crypto from 'crypto'
import {
  GITHUB_ISSUE_COMMENT,
  GITHUB_ISSUE_LABELED,
  GITHUB_PR_REVIEW,
  inngest,
} from '@skillrecordings/core/inngest'
import { log } from '@skillrecordings/core/observability/axiom'

const WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET

/**
 * Verify GitHub webhook signature (HMAC SHA-256)
 */
function verifySignature(payload: string, signature: string | null): boolean {
  if (!WEBHOOK_SECRET || !signature) {
    return false
  }

  const expected = `sha256=${crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(payload)
    .digest('hex')}`

  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
}

export async function POST(request: Request) {
  const body = await request.text()
  const signature = request.headers.get('x-hub-signature-256')
  const event = request.headers.get('x-github-event')
  const deliveryId = request.headers.get('x-github-delivery')

  // Verify signature
  if (!verifySignature(body, signature)) {
    await log('warn', 'GitHub webhook signature verification failed', {
      component: 'github-webhooks',
      event,
      deliveryId,
    })
    return new Response('Invalid signature', { status: 401 })
  }

  let payload: any
  try {
    payload = JSON.parse(body)
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }

  await log('info', 'GitHub webhook received', {
    component: 'github-webhooks',
    event,
    deliveryId,
    action: payload.action,
    repo: payload.repository?.full_name,
  })

  try {
    // Route to appropriate handler based on event type
    switch (event) {
      case 'issue_comment': {
        // Comment on an issue or PR
        await inngest.send({
          name: GITHUB_ISSUE_COMMENT,
          data: {
            action: payload.action, // created, edited, deleted
            comment: {
              id: payload.comment.id,
              body: payload.comment.body,
              user: payload.comment.user.login,
              createdAt: payload.comment.created_at,
              htmlUrl: payload.comment.html_url,
            },
            issue: {
              number: payload.issue.number,
              title: payload.issue.title,
              state: payload.issue.state,
              labels: payload.issue.labels?.map((l: any) => l.name) ?? [],
              htmlUrl: payload.issue.html_url,
            },
            repository: {
              fullName: payload.repository.full_name,
              owner: payload.repository.owner.login,
              name: payload.repository.name,
            },
            sender: payload.sender.login,
            deliveryId,
          },
        })
        break
      }

      case 'pull_request_review': {
        // PR review submitted
        await inngest.send({
          name: GITHUB_PR_REVIEW,
          data: {
            action: payload.action, // submitted, edited, dismissed
            review: {
              id: payload.review.id,
              body: payload.review.body,
              state: payload.review.state, // approved, changes_requested, commented
              user: payload.review.user.login,
              submittedAt: payload.review.submitted_at,
              htmlUrl: payload.review.html_url,
            },
            pullRequest: {
              number: payload.pull_request.number,
              title: payload.pull_request.title,
              state: payload.pull_request.state,
              htmlUrl: payload.pull_request.html_url,
              head: payload.pull_request.head.ref,
              base: payload.pull_request.base.ref,
            },
            repository: {
              fullName: payload.repository.full_name,
              owner: payload.repository.owner.login,
              name: payload.repository.name,
            },
            sender: payload.sender.login,
            deliveryId,
          },
        })
        break
      }

      case 'issues': {
        // Issue state changes - specifically watch for labeling
        if (payload.action === 'labeled' || payload.action === 'unlabeled') {
          await inngest.send({
            name: GITHUB_ISSUE_LABELED,
            data: {
              action: payload.action,
              label: payload.label?.name,
              issue: {
                number: payload.issue.number,
                title: payload.issue.title,
                state: payload.issue.state,
                labels: payload.issue.labels?.map((l: any) => l.name) ?? [],
                htmlUrl: payload.issue.html_url,
                body: payload.issue.body,
              },
              repository: {
                fullName: payload.repository.full_name,
                owner: payload.repository.owner.login,
                name: payload.repository.name,
              },
              sender: payload.sender.login,
              deliveryId,
            },
          })
        }
        break
      }

      case 'ping': {
        // GitHub sends this when webhook is first configured
        await log('info', 'GitHub webhook ping received', {
          component: 'github-webhooks',
          zen: payload.zen,
          hookId: payload.hook_id,
        })
        break
      }

      default:
        await log('debug', 'Unhandled GitHub event', {
          component: 'github-webhooks',
          event,
          action: payload.action,
        })
    }

    return new Response('OK', { status: 200 })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await log('error', 'GitHub webhook processing failed', {
      component: 'github-webhooks',
      event,
      deliveryId,
      error: message,
    })
    // Return 200 to prevent GitHub retries on our errors
    return new Response('OK', { status: 200 })
  }
}
