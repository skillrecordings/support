/**
 * Step: CATALOG_VOC
 *
 * Handles Voice of Customer responses:
 * 1. Analyze sentiment and themes
 * 2. Store in VOC catalog
 * 3. Notify Slack
 * 4. Optionally request testimonial expansion
 */

import { generateObject } from 'ai'
import { z } from 'zod'
import type {
  ThreadClassifyOutput,
  ThreadMessage,
  VocAnalysis,
  VocSentiment,
} from '../types'

// ============================================================================
// VOC Analysis Schema
// ============================================================================

const vocAnalysisSchema = z.object({
  sentiment: z.enum([
    'voc_positive',
    'voc_feedback',
    'voc_blocker',
    'voc_testimonial_candidate',
  ]),
  confidence: z.number().min(0).max(1),
  themes: z.array(z.string()),
  quotableExcerpt: z.string().optional(),
  shouldRequestExpansion: z.boolean(),
  expansionReason: z.string().optional(),
})

// ============================================================================
// VOC Analysis Prompt
// ============================================================================

const VOC_ANALYSIS_PROMPT = `You are analyzing a Voice of Customer (VOC) response - a customer's reply to our automated outreach email.

Classify the sentiment and extract insights:

**Sentiments:**
- voc_positive: Praise, success stories, enthusiasm, gratitude ("loving it", "changed how I work")
- voc_feedback: Suggestions, feature requests, constructive criticism ("would be nice to have", "I wish")
- voc_blocker: Obstacles, time constraints, hesitation ("too busy", "haven't started", "not sure where to begin")
- voc_testimonial_candidate: Compelling story with specific results, quotable, has before/after arc

**Extract:**
1. Primary sentiment (with confidence 0-1)
2. Themes (e.g., "course_quality", "time_constraints", "ai_adoption", "career_growth")
3. Best quotable excerpt (if any) - a sentence or two that captures the essence
4. Whether to request expansion (true for testimonial candidates with specific results)
5. Expansion reason (if requesting)

**Testimonial candidate signals:**
- Specific outcomes ("increased productivity by X", "shipped my first app")
- Career/skill transformation story
- Emotional arc (struggle → learning → success)
- Genuine enthusiasm (not just "thanks")
- Would look good on a landing page

Analyze the following message:`

// ============================================================================
// Input/Output Types
// ============================================================================

export interface CatalogVocInput {
  conversationId: string
  appId: string
  customerEmail?: string
  messages: ThreadMessage[]
  classification: ThreadClassifyOutput
  sourceCampaign?: string // Which email sequence triggered this
}

export interface CatalogVocOutput {
  analysis: VocAnalysis
  cataloged: boolean
  catalogId?: string
  slackNotified: boolean
  expansionRequested: boolean
  error?: string
}

// ============================================================================
// VOC Analysis
// ============================================================================

export async function analyzeVocResponse(
  messages: ThreadMessage[],
  model: string = 'anthropic/claude-sonnet-4-5'
): Promise<VocAnalysis> {
  // Combine customer messages for analysis
  const customerMessages = messages
    .filter((m) => m.direction === 'in')
    .map((m) => m.body)
    .join('\n---\n')

  const { object } = await generateObject({
    model,
    schema: vocAnalysisSchema,
    system: VOC_ANALYSIS_PROMPT,
    prompt: customerMessages,
  })

  return object as VocAnalysis
}

// ============================================================================
// Slack Notification
// ============================================================================

const SENTIMENT_EMOJI: Record<VocSentiment, string> = {
  voc_positive: '🎉',
  voc_feedback: '💡',
  voc_blocker: '⏰',
  voc_testimonial_candidate: '⭐',
}

const SENTIMENT_LABEL: Record<VocSentiment, string> = {
  voc_positive: 'Positive',
  voc_feedback: 'Feedback',
  voc_blocker: 'Blocker',
  voc_testimonial_candidate: 'Testimonial Candidate',
}

export function formatSlackMessage(
  analysis: VocAnalysis,
  conversationId: string,
  customerEmail?: string,
  appId?: string
): object {
  const emoji = SENTIMENT_EMOJI[analysis.sentiment]
  const label = SENTIMENT_LABEL[analysis.sentiment]
  const themes = analysis.themes
    .map((t) => `#${t.replace(/[^a-z0-9]/gi, '-')}`)
    .join(' ')

  // Front conversation link (customize domain as needed)
  const frontLink = `https://app.frontapp.com/open/${conversationId}`

  const blocks = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: '📣 New VOC Response',
        emoji: true,
      },
    },
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*Sentiment:* ${emoji} ${label}`,
        },
        {
          type: 'mrkdwn',
          text: `*Confidence:* ${Math.round(analysis.confidence * 100)}%`,
        },
        {
          type: 'mrkdwn',
          text: `*From:* ${customerEmail || 'Unknown'}`,
        },
        {
          type: 'mrkdwn',
          text: `*App:* ${appId || 'Unknown'}`,
        },
      ],
    },
  ]

  // Add quotable excerpt if present
  if (analysis.quotableExcerpt) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `> ${analysis.quotableExcerpt}`,
      },
    } as any)
  }

  // Add themes
  if (analysis.themes.length > 0) {
    blocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `*Themes:* ${themes}`,
        },
      ],
    } as any)
  }

  // Add expansion notice if applicable
  if (analysis.shouldRequestExpansion) {
    blocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `✨ *Requesting expansion for testimonial use*${analysis.expansionReason ? `: ${analysis.expansionReason}` : ''}`,
        },
      ],
    } as any)
  }

  // Add link to Front
  blocks.push({
    type: 'actions',
    elements: [
      {
        type: 'button',
        text: {
          type: 'plain_text',
          text: 'View in Front →',
          emoji: true,
        },
        url: frontLink,
      },
    ],
  } as any)

  return { blocks }
}

export async function notifySlack(
  webhookUrl: string,
  message: object
): Promise<boolean> {
  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
    })
    return response.ok
  } catch (error) {
    console.error('Failed to notify Slack:', error)
    return false
  }
}

// ============================================================================
// Expansion Request
// ============================================================================

export function shouldRequestExpansion(analysis: VocAnalysis): boolean {
  return (
    analysis.sentiment === 'voc_testimonial_candidate' &&
    analysis.confidence >= 0.8 &&
    analysis.shouldRequestExpansion
  )
}

export function formatExpansionRequest(
  customerName: string,
  instructorName: string = 'Matt'
): string {
  return `Hi ${customerName},

Thanks so much for sharing that with us! Your experience really resonated.

Would you be open to sharing a bit more about your journey? We'd love to feature your story (with your permission) to help others see what's possible.

No pressure at all—just reply if you're interested.

Best,
${instructorName}`
}

// ============================================================================
// Main Catalog Function
// ============================================================================

export interface CatalogVocOptions {
  model?: string
  slackWebhookUrl?: string
  skipSlack?: boolean
  skipExpansion?: boolean
  dryRun?: boolean
}

export async function catalogVoc(
  input: CatalogVocInput,
  options: CatalogVocOptions = {}
): Promise<CatalogVocOutput> {
  const {
    model = 'anthropic/claude-sonnet-4-5',
    slackWebhookUrl,
    skipSlack = false,
    skipExpansion = false,
    dryRun = false,
  } = options

  try {
    // 1. Analyze VOC response
    const analysis = await analyzeVocResponse(input.messages, model)

    // 2. Store in catalog (TODO: implement database storage)
    let catalogId: string | undefined
    if (!dryRun) {
      // catalogId = await storeVocResponse({ ... })
      catalogId = `voc_${Date.now()}_${input.conversationId.slice(-6)}`
    }

    // 3. Notify Slack
    let slackNotified = false
    if (!skipSlack && slackWebhookUrl) {
      const slackMessage = formatSlackMessage(
        analysis,
        input.conversationId,
        input.customerEmail,
        input.appId
      )
      if (!dryRun) {
        slackNotified = await notifySlack(slackWebhookUrl, slackMessage)
      } else {
        slackNotified = true // Would notify in production
      }
    }

    // 4. Request expansion if appropriate
    let expansionRequested = false
    if (!skipExpansion && shouldRequestExpansion(analysis)) {
      // TODO: Queue expansion request email
      // This would integrate with Front's API to send a draft or schedule
      expansionRequested = true
    }

    return {
      analysis,
      cataloged: !!catalogId,
      catalogId,
      slackNotified,
      expansionRequested,
    }
  } catch (error) {
    console.error('Failed to catalog VOC:', error)
    return {
      analysis: {
        sentiment: 'voc_positive',
        confidence: 0,
        themes: [],
        shouldRequestExpansion: false,
      },
      cataloged: false,
      slackNotified: false,
      expansionRequested: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

// ============================================================================
// Export for pipeline
// ============================================================================

export type { VocAnalysis, VocSentiment }
