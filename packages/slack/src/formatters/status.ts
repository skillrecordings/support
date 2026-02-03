export type SlackBlock = {
  type: string
  text?: {
    type: 'mrkdwn' | 'plain_text'
    text: string
    emoji?: boolean
  }
  fields?: Array<{
    type: 'mrkdwn'
    text: string
  }>
}

export interface StatusItem {
  conversationId: string
  subject: string
  ageLabel: string
  productCode?: string
}

export interface PendingSummaryItem {
  label: string
  count: number
}

export interface HealthStats {
  handledToday: number
  pending: number
  avgResponseHours: number
}

export function buildFrontLink(conversationId: string): string {
  return `https://app.frontapp.com/open/${conversationId}`
}

function formatHeader(title: string): SlackBlock {
  return {
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: title,
    },
  }
}

function formatListSection(title: string, lines: string[]): SlackBlock {
  const text = [title, ...lines].join('\n')
  return {
    type: 'section',
    text: {
      type: 'mrkdwn',
      text,
    },
  }
}

export function formatUrgentBlocks(input: {
  items: StatusItem[]
}): { text: string; blocks: SlackBlock[] } {
  const count = input.items.length
  const lines = count
    ? input.items.map((item) => {
        const productPrefix = item.productCode ? `[${item.productCode}] ` : ''
        const link = buildFrontLink(item.conversationId)
        return `• ${productPrefix}${item.subject} — ${item.ageLabel} <${link}|View>`
      })
    : ['• No urgent conversations right now.']

  const blocks: SlackBlock[] = [
    formatHeader('📊 *Support Status*'),
    { type: 'divider' },
    formatListSection(`🔴 *Urgent (${count})*`, lines),
  ]

  return {
    text: `Support status: ${count} urgent`,
    blocks,
  }
}

export function formatPendingBlocks(input: {
  total: number
  summary: PendingSummaryItem[]
}): { text: string; blocks: SlackBlock[] } {
  const lines = input.summary.length
    ? input.summary.map((item) => `• ${item.label}: ${item.count}`)
    : ['• No pending conversations.']

  const blocks: SlackBlock[] = [
    formatHeader('📊 *Support Status*'),
    { type: 'divider' },
    formatListSection(`📋 *Pending Summary (${input.total})*`, lines),
  ]

  return {
    text: `Support status: ${input.total} pending`,
    blocks,
  }
}

export function formatHealthBlocks(input: {
  stats: HealthStats
}): { text: string; blocks: SlackBlock[] } {
  const { handledToday, pending, avgResponseHours } = input.stats
  const lines = [
    `• Handled today: ${handledToday}`,
    `• Pending: ${pending}`,
    `• Avg response: ${avgResponseHours}h`,
  ]

  const blocks: SlackBlock[] = [
    formatHeader('📊 *Support Status*'),
    { type: 'divider' },
    formatListSection('📋 *Summary*', lines),
  ]

  return {
    text: `Support status: ${pending} pending, ${handledToday} handled today`,
    blocks,
  }
}
