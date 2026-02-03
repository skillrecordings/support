import { initializeAxiom, log } from '../../../core/src/observability/axiom'
import { type FrontClient, createFrontClient } from '../../../front-sdk/src'

export type QuickAction =
  | { type: 'approve_send' }
  | { type: 'escalate'; assignee: string }
  | { type: 'add_context'; note: string }
  | { type: 'archive' }
  | { type: 'close' }

export interface QuickActionContext {
  conversationId: string
  draftText?: string
  recipientEmail?: string
  threadTs?: string
  channel?: string
  requestedBy?: string
}

export interface QuickActionDeps {
  frontClient?: Pick<FrontClient, 'conversations' | 'raw'>
  logger?: typeof log
  initializeAxiom?: typeof initializeAxiom
  resolveAssigneeId?: (
    assignee: string
  ) => Promise<string | null> | string | null
  resolveSlackUserId?: (
    assignee: string
  ) => Promise<string | null> | string | null
}

export interface QuickActionResult {
  ok: boolean
  message: string
  partial?: boolean
}

function getFrontClient(
  deps?: QuickActionDeps
): Pick<FrontClient, 'conversations' | 'raw'> {
  if (deps?.frontClient) return deps.frontClient
  const apiToken = process.env.FRONT_API_TOKEN ?? process.env.FRONT_API_KEY
  if (!apiToken) {
    throw new Error('FRONT_API_TOKEN not configured')
  }
  return createFrontClient({ apiToken })
}

function getLogger(deps?: QuickActionDeps): typeof log {
  return deps?.logger ?? log
}

function getInitializer(deps?: QuickActionDeps): typeof initializeAxiom {
  return deps?.initializeAxiom ?? initializeAxiom
}

function buildEscalationAssignee(text: string): string | null {
  const match = text.match(/\bescalate\s+to\s+([^?!.]+)$/i)
  if (!match?.[1]) return null
  return match[1].trim().replace(/[\s,]+$/g, '')
}

function buildContextNote(text: string): string | null {
  const explicit = text.match(/\badd\s+context[:\-]?\s+(.+)/i)
  if (explicit?.[1]) return explicit[1].trim()

  if (/need(s)? more context/i.test(text)) {
    return 'Needs more context.'
  }

  return null
}

export function parseQuickAction(rawText: string): QuickAction | null {
  const text = rawText.trim()
  if (!text) return null

  const normalized = text.toLowerCase()

  if (/\bapprove\s+and\s+send\b/i.test(normalized)) {
    return { type: 'approve_send' }
  }

  if (/\bescalate\b/i.test(normalized)) {
    const assignee = buildEscalationAssignee(text)
    if (assignee) return { type: 'escalate', assignee }
    return null
  }

  const note = buildContextNote(text)
  if (note) {
    return { type: 'add_context', note }
  }

  if (/\barchive\b/i.test(normalized)) {
    return { type: 'archive' }
  }

  if (/\bclose\b/i.test(normalized)) {
    return { type: 'close' }
  }

  return null
}

async function logAction(
  deps: QuickActionDeps | undefined,
  action: QuickAction,
  context: QuickActionContext,
  result: QuickActionResult,
  level: 'info' | 'warn' | 'error' = 'info'
): Promise<void> {
  const logger = getLogger(deps)
  const initialize = getInitializer(deps)
  initialize()
  await logger(level, 'slack.quick_action', {
    actionType: action.type,
    conversationId: context.conversationId,
    threadTs: context.threadTs,
    channel: context.channel,
    requestedBy: context.requestedBy,
    success: result.ok,
    partial: result.partial ?? false,
  })
}

function assertConversationId(context: QuickActionContext): string | null {
  if (!context.conversationId) {
    return null
  }
  return context.conversationId
}

export async function handleApproveSend(
  context: QuickActionContext,
  deps?: QuickActionDeps
): Promise<QuickActionResult> {
  const conversationId = assertConversationId(context)
  if (!conversationId) {
    return {
      ok: false,
      message: 'I need a conversation id before I can send this response.',
    }
  }

  if (!context.draftText) {
    return {
      ok: false,
      message: "I couldn't find a draft in this thread to send.",
    }
  }

  const front = getFrontClient(deps)

  try {
    await front.raw.post(`/conversations/${conversationId}/messages`, {
      body: context.draftText,
    })
  } catch (error) {
    const result = {
      ok: false,
      message: "I couldn't send the response. Please try again.",
    }
    await logAction(deps, { type: 'approve_send' }, context, result, 'error')
    return result
  }

  try {
    await front.conversations.update(conversationId, { status: 'archived' })
  } catch (error) {
    const result = {
      ok: true,
      partial: true,
      message:
        '✅ Response sent, but I could not archive the conversation. Please check Front.',
    }
    await logAction(deps, { type: 'approve_send' }, context, result, 'warn')
    return result
  }

  const result = {
    ok: true,
    message: '✅ Response sent! Conversation archived.',
  }
  await logAction(deps, { type: 'approve_send' }, context, result)
  return result
}

export async function handleEscalate(
  action: Extract<QuickAction, { type: 'escalate' }>,
  context: QuickActionContext,
  deps?: QuickActionDeps
): Promise<QuickActionResult> {
  const conversationId = assertConversationId(context)
  if (!conversationId) {
    return {
      ok: false,
      message: 'I need a conversation id before I can escalate this.',
    }
  }

  if (!action.assignee) {
    return {
      ok: false,
      message: 'Who should I escalate this to?',
    }
  }

  const resolveAssigneeId = deps?.resolveAssigneeId
  if (!resolveAssigneeId) {
    return {
      ok: false,
      message: `I couldn't map ${action.assignee} to a Front teammate.`,
    }
  }

  const assigneeId = await resolveAssigneeId(action.assignee)
  if (!assigneeId) {
    return {
      ok: false,
      message: `I couldn't find a Front teammate for ${action.assignee}.`,
    }
  }

  const front = getFrontClient(deps)

  try {
    await front.conversations.updateAssignee(conversationId, assigneeId)
  } catch (error) {
    const result = {
      ok: false,
      message: "I couldn't reassign this conversation. Please try again.",
    }
    await logAction(deps, action, context, result, 'error')
    return result
  }

  const resolveSlackUserId = deps?.resolveSlackUserId
  const slackUserId = resolveSlackUserId
    ? await resolveSlackUserId(action.assignee)
    : null
  const mention = slackUserId ? ` (<@${slackUserId}>)` : ''
  const result = {
    ok: true,
    message: `Escalated to ${action.assignee}${mention}.`,
  }
  await logAction(deps, action, context, result)
  return result
}

export async function handleAddContext(
  action: Extract<QuickAction, { type: 'add_context' }>,
  context: QuickActionContext,
  deps?: QuickActionDeps
): Promise<QuickActionResult> {
  const conversationId = assertConversationId(context)
  if (!conversationId) {
    return {
      ok: false,
      message: 'I need a conversation id before I can add context.',
    }
  }

  if (!action.note) {
    return {
      ok: false,
      message: 'What context should I add?',
    }
  }

  const front = getFrontClient(deps)

  try {
    await front.conversations.addComment(conversationId, action.note)
  } catch (error) {
    const result = {
      ok: false,
      message: "I couldn't add the context note. Please try again.",
    }
    await logAction(deps, action, context, result, 'error')
    return result
  }

  const result = {
    ok: true,
    message: 'Context note added.',
  }
  await logAction(deps, action, context, result)
  return result
}

export async function handleArchive(
  context: QuickActionContext,
  deps?: QuickActionDeps
): Promise<QuickActionResult> {
  const conversationId = assertConversationId(context)
  if (!conversationId) {
    return {
      ok: false,
      message: 'I need a conversation id before I can archive this.',
    }
  }

  const front = getFrontClient(deps)

  try {
    await front.conversations.update(conversationId, { status: 'archived' })
  } catch (error) {
    const result = {
      ok: false,
      message: "I couldn't archive the conversation. Please try again.",
    }
    await logAction(deps, { type: 'archive' }, context, result, 'error')
    return result
  }

  const result = {
    ok: true,
    message: 'Conversation archived.',
  }
  await logAction(deps, { type: 'archive' }, context, result)
  return result
}

export async function handleClose(
  context: QuickActionContext,
  deps?: QuickActionDeps
): Promise<QuickActionResult> {
  const conversationId = assertConversationId(context)
  if (!conversationId) {
    return {
      ok: false,
      message: 'I need a conversation id before I can close this.',
    }
  }

  const front = getFrontClient(deps)

  try {
    await front.conversations.update(conversationId, { status: 'archived' })
  } catch (error) {
    const result = {
      ok: false,
      message: "I couldn't close the conversation. Please try again.",
    }
    await logAction(deps, { type: 'close' }, context, result, 'error')
    return result
  }

  const result = {
    ok: true,
    message: 'Conversation closed.',
  }
  await logAction(deps, { type: 'close' }, context, result)
  return result
}

export async function handleQuickAction(
  action: QuickAction,
  context: QuickActionContext,
  deps?: QuickActionDeps
): Promise<QuickActionResult> {
  switch (action.type) {
    case 'approve_send':
      return handleApproveSend(context, deps)
    case 'escalate':
      return handleEscalate(action, context, deps)
    case 'add_context':
      return handleAddContext(action, context, deps)
    case 'archive':
      return handleArchive(context, deps)
    case 'close':
      return handleClose(context, deps)
    default:
      return {
        ok: false,
        message: "I couldn't determine the requested action.",
      }
  }
}
