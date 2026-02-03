import { generateText } from 'ai'
import { initializeAxiom, log } from '../../../core/src/observability/axiom'

export type RefinementIntent =
  | { type: 'simplify' }
  | { type: 'formalize' }
  | { type: 'shorten' }
  | { type: 'add_content'; content: string }
  | { type: 'mention_topic'; topic: string }
  | { type: 'approve' }
  | { type: 'reject'; reason?: string }

export interface DraftVersion {
  id: string
  text: string
  createdAt: Date
  intent?: RefinementIntent
}

export type DraftStatus = 'draft' | 'approved' | 'rejected' | 'sent'

export interface DraftThreadState {
  threadTs: string
  versions: DraftVersion[]
  status: DraftStatus
  approvedAt?: Date
  rejectedAt?: Date
  sentAt?: Date
  conversationId?: string
  recipientEmail?: string
}

export interface DraftStore {
  get(threadTs: string): DraftThreadState | undefined
  set(threadTs: string, state: DraftThreadState): void
}

export interface DraftRefinementDeps {
  generateText?: typeof generateText
  model?: string
  logger?: typeof log
  initializeAxiom?: typeof initializeAxiom
  now?: () => Date
}

export interface DraftRefinementContext {
  threadTs?: string
  userId?: string
  channel?: string
  traceId?: string
}

export interface DraftRefinementResult {
  state: DraftThreadState
  revision: DraftVersion
  indicator: string
  charDelta: number
}

const DEFAULT_MODEL = 'anthropic/claude-sonnet-4-5'
const DEFAULT_STORE = createDraftStore()

function getNow(deps?: DraftRefinementDeps): Date {
  return deps?.now ? deps.now() : new Date()
}

function getLogger(deps?: DraftRefinementDeps): typeof log {
  return deps?.logger ?? log
}

function getInitializer(deps?: DraftRefinementDeps): typeof initializeAxiom {
  return deps?.initializeAxiom ?? initializeAxiom
}

export function createDraftStore(
  store = new Map<string, DraftThreadState>()
): DraftStore {
  return {
    get: (threadTs) => store.get(threadTs),
    set: (threadTs, state) => store.set(threadTs, state),
  }
}

export function createDraftThreadState(
  threadTs: string,
  draftText: string,
  deps?: DraftRefinementDeps
): DraftThreadState {
  const now = getNow(deps)
  return {
    threadTs,
    versions: [
      {
        id: 'v0',
        text: draftText,
        createdAt: now,
      },
    ],
    status: 'draft',
  }
}

export function registerDraftForThread(
  threadTs: string,
  draftText: string,
  deps?: DraftRefinementDeps & { draftStore?: DraftStore }
): DraftThreadState {
  const store = deps?.draftStore ?? DEFAULT_STORE
  const state = createDraftThreadState(threadTs, draftText, deps)
  store.set(threadTs, state)
  return state
}

export function getDraftStore(deps?: { draftStore?: DraftStore }): DraftStore {
  return deps?.draftStore ?? DEFAULT_STORE
}

export function parseRefinementIntent(
  rawText: string
): RefinementIntent | null {
  const text = rawText.trim()
  if (!text) return null

  const normalized = text.toLowerCase()

  if (
    /^(looks good|look good|approve|approved|ship it|send it|good to go)\b/i.test(
      normalized
    )
  ) {
    return { type: 'approve' }
  }

  const rejectMatch = normalized.match(
    /^(reject|rejected|no thanks|not good|needs work|don't send|do not send)\b\s*(.*)$/i
  )
  if (rejectMatch) {
    const reason = rejectMatch[2]?.trim()
    return reason ? { type: 'reject', reason } : { type: 'reject' }
  }

  if (/\bsimplify\b|\bsimpler\b|make it simpler/i.test(normalized)) {
    return { type: 'simplify' }
  }

  if (/\bformal(ize|ise)\b|more formal/i.test(normalized)) {
    return { type: 'formalize' }
  }

  if (/\bshorten\b|make it shorter|too long/i.test(normalized)) {
    return { type: 'shorten' }
  }

  const mentionMatch = text.match(/(?:mention|include)\s+topic\s+(.+)/i)
  if (mentionMatch?.[1]) {
    return { type: 'mention_topic', topic: mentionMatch[1].trim() }
  }

  const bracketAddMatch = text.match(/^(?:add|include)\s*\[(.+)\]\s*$/i)
  if (bracketAddMatch?.[1]) {
    return { type: 'add_content', content: bracketAddMatch[1].trim() }
  }

  const addMatch = text.match(/^(?:add|include)\s+(.+)/i)
  if (addMatch?.[1]) {
    return { type: 'add_content', content: addMatch[1].trim() }
  }

  return null
}

function buildRefinementInstruction(intent: RefinementIntent): string {
  switch (intent.type) {
    case 'simplify':
      return 'Simplify the language while preserving meaning.'
    case 'formalize':
      return 'Make the tone more formal and professional.'
    case 'shorten':
      return 'Shorten the draft while keeping key information.'
    case 'add_content':
      return `Add the following content: ${intent.content}`
    case 'mention_topic':
      return `Explicitly mention the topic: ${intent.topic}`
    default:
      return 'Revise the draft based on the latest feedback.'
  }
}

function buildDiffIndicator(previous: string, next: string): string {
  const delta = next.length - previous.length
  if (delta === 0) return 'no length change'
  return `${delta > 0 ? '+' : ''}${delta} chars`
}

export async function applyRefinement(
  state: DraftThreadState,
  intent: RefinementIntent,
  deps?: DraftRefinementDeps,
  context?: DraftRefinementContext
): Promise<DraftRefinementResult> {
  const previous = state.versions[state.versions.length - 1]
  const model = deps?.model ?? DEFAULT_MODEL
  const generate = deps?.generateText ?? generateText
  const instruction = buildRefinementInstruction(intent)

  const result = await generate({
    model,
    system:
      'You are refining a customer support draft. Return only the revised draft text.',
    messages: [
      {
        role: 'user',
        content: `Current draft:\n${previous.text}\n\nInstruction: ${instruction}`,
      },
    ],
  })

  const revisedText = result.text.trim() || previous.text
  const now = getNow(deps)
  const revision: DraftVersion = {
    id: `v${state.versions.length}`,
    text: revisedText,
    createdAt: now,
    intent,
  }

  const updated: DraftThreadState = {
    ...state,
    versions: [...state.versions, revision],
    status: 'draft',
  }

  const indicator = buildDiffIndicator(previous.text, revisedText)
  const charDelta = revisedText.length - previous.text.length

  const initialize = getInitializer(deps)
  const logger = getLogger(deps)
  initialize()
  await logger('info', 'slack.draft_refined', {
    threadTs: context?.threadTs ?? state.threadTs,
    userId: context?.userId,
    channel: context?.channel,
    traceId: context?.traceId,
    intentType: intent.type,
    version: revision.id,
    charDelta,
    model,
  })

  return {
    state: updated,
    revision,
    indicator,
    charDelta,
  }
}

export function markDraftStatus(
  state: DraftThreadState,
  status: DraftStatus,
  deps?: DraftRefinementDeps
): DraftThreadState {
  const now = getNow(deps)
  if (status === 'approved') {
    return { ...state, status, approvedAt: now }
  }
  if (status === 'rejected') {
    return { ...state, status, rejectedAt: now }
  }
  if (status === 'sent') {
    return { ...state, status, sentAt: now }
  }
  return { ...state, status }
}

export function formatRevisionMessage(
  revision: DraftVersion,
  indicator: string
): string {
  return `Updated draft ${revision.id} (${indicator})\n\n${revision.text}`
}
