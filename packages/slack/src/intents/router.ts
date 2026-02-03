import type { ParsedIntent } from './types'

export const HELP_RESPONSE = `I can help with:
- Status queries: "anything urgent?", "whats pending?", "status"
- Draft refinement: reply to my draft notifications with feedback
- Quick actions: "approve and send", "escalate to [name]", "archive"
- Customer lookup: "history with customer@email.com"

Just @mention me with what you need!`

const emailRegex = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i

function extractEmail(text: string): string | undefined {
  const match = text.match(emailRegex)
  return match?.[0]
}

function extractName(text: string): string | undefined {
  const match = text.match(
    /\b(?:escalate to|who is|history with)\s+([^?!.]+)$/i
  )
  if (!match?.[1]) return undefined
  return match[1].trim().replace(/[\s,]+$/g, '')
}

function buildIntent(
  category: ParsedIntent['category'],
  rawText: string,
  confidence: number,
  entities: Record<string, string> = {}
): ParsedIntent {
  return { category, confidence, entities, rawText }
}

export function routeIntent(rawText: string): {
  intent: ParsedIntent
  response: string
} {
  const trimmed = rawText.trim()
  if (!trimmed) {
    return {
      intent: buildIntent('unknown', trimmed, 0.1),
      response: HELP_RESPONSE,
    }
  }

  const normalized = trimmed.toLowerCase()
  const email = extractEmail(trimmed)
  const name = extractName(trimmed)

  const statusHit =
    normalized.includes('status') ||
    normalized.includes('anything urgent') ||
    normalized.includes("what's pending") ||
    normalized.includes('whats pending') ||
    normalized.includes('pending') ||
    normalized.includes('urgent')

  if (statusHit) {
    return {
      intent: buildIntent('status_query', trimmed, 0.85),
      response:
        "status noted — I'll check what's pending and report back in this thread.",
    }
  }

  const draftHit =
    normalized.includes('approve') ||
    normalized.includes('send') ||
    normalized.includes('simplify') ||
    normalized.includes('rewrite') ||
    normalized.includes('shorten')

  if (draftHit) {
    return {
      intent: buildIntent('draft_action', trimmed, 0.8),
      response: 'Thanks — I captured your draft feedback and will apply it.',
    }
  }

  const escalationHit = normalized.includes('escalate')

  if (escalationHit) {
    const entities: Record<string, string> = {}
    if (name) entities.name = name
    return {
      intent: buildIntent('escalation', trimmed, 0.8, entities),
      response: name
        ? `Okay — I'll escalate to ${name}.`
        : "Okay — I'll escalate this to the right teammate.",
    }
  }

  const contextHit =
    normalized.includes('history') ||
    normalized.includes('who is') ||
    normalized.includes('lookup') ||
    normalized.includes('context') ||
    Boolean(email)

  if (contextHit) {
    const entities: Record<string, string> = {}
    if (email) entities.email = email
    if (name && !entities.email) entities.name = name
    return {
      intent: buildIntent('context_lookup', trimmed, 0.78, entities),
      response: 'On it — I will pull the customer context and share it here.',
    }
  }

  return {
    intent: buildIntent('unknown', trimmed, 0.2),
    response: HELP_RESPONSE,
  }
}
