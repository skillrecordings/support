import type { QuickAction, QuickActionContext } from '../intents/action'

export interface ActionConfirmationState {
  threadTs: string
  action: QuickAction
  context: QuickActionContext
  createdAt: Date
}

export interface ActionConfirmationStore {
  get(threadTs: string): ActionConfirmationState | undefined
  set(threadTs: string, state: ActionConfirmationState): void
  delete(threadTs: string): void
}

export interface ActionConfirmationRequest {
  store: ActionConfirmationStore
  threadTs: string
  action: QuickAction
  context: QuickActionContext
  now?: () => Date
}

export type ActionConfirmationResolution =
  | { status: 'confirm'; action: QuickAction; context: QuickActionContext }
  | { status: 'cancel' }
  | { status: 'ignore' }

const DEFAULT_STORE = createActionConfirmationStore()

function getNow(now?: () => Date): Date {
  return now ? now() : new Date()
}

export function createActionConfirmationStore(
  store = new Map<string, ActionConfirmationState>()
): ActionConfirmationStore {
  return {
    get: (threadTs) => store.get(threadTs),
    set: (threadTs, state) => store.set(threadTs, state),
    delete: (threadTs) => store.delete(threadTs),
  }
}

export function getActionConfirmationStore(deps?: {
  confirmationStore?: ActionConfirmationStore
}): ActionConfirmationStore {
  return deps?.confirmationStore ?? DEFAULT_STORE
}

export function requiresActionConfirmation(action: QuickAction): boolean {
  switch (action.type) {
    case 'approve_send':
    case 'archive':
    case 'close':
      return true
    default:
      return false
  }
}

function buildDraftPreview(text: string, limit = 200): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length <= limit) return normalized
  return `${normalized.slice(0, limit)}...`
}

export function buildActionConfirmationMessage(
  action: QuickAction,
  context: QuickActionContext
): string {
  switch (action.type) {
    case 'approve_send': {
      const recipient = context.recipientEmail ?? 'the customer'
      const draftText = context.draftText?.trim()
      const preview = draftText
        ? buildDraftPreview(draftText)
        : 'No draft text available.'
      return `Ready to send this response to ${recipient}:
> ${preview}
Reply yes to confirm or cancel to abort.`
    }
    case 'archive':
    case 'close':
      return `You're about to archive this conversation. Reply yes to confirm or cancel to abort.`
    case 'escalate':
      return `You're about to escalate this conversation to ${action.assignee}. Reply yes to confirm or cancel to abort.`
    case 'add_context':
      return `You're about to add an internal context note. Reply yes to confirm or cancel to abort.`
    default:
      return 'Reply yes to confirm or cancel to abort.'
  }
}

export function requestActionConfirmation(request: ActionConfirmationRequest): {
  message: string
  state: ActionConfirmationState
} {
  const state: ActionConfirmationState = {
    threadTs: request.threadTs,
    action: request.action,
    context: request.context,
    createdAt: getNow(request.now),
  }

  request.store.set(request.threadTs, state)

  return {
    message: buildActionConfirmationMessage(request.action, request.context),
    state,
  }
}

export function parseActionConfirmationResponse(
  text: string
): 'confirm' | 'cancel' | null {
  const normalized = text.trim().toLowerCase()
  if (!normalized) return null

  if (/^(yes|yep|y|confirm|approved|approve)$/i.test(normalized)) {
    return 'confirm'
  }

  if (/^(no|cancel|stop|abort|nevermind)$/i.test(normalized)) {
    return 'cancel'
  }

  return null
}

export function resolveActionConfirmation(
  store: ActionConfirmationStore,
  threadTs: string,
  responseText: string
): ActionConfirmationResolution {
  const state = store.get(threadTs)
  if (!state) return { status: 'ignore' }

  const decision = parseActionConfirmationResponse(responseText)
  if (!decision) return { status: 'ignore' }

  store.delete(threadTs)

  if (decision === 'cancel') {
    return { status: 'cancel' }
  }

  return { status: 'confirm', action: state.action, context: state.context }
}
