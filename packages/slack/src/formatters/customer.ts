import { buildFrontLink } from './status'

export type SlackBlock = {
  type: string
  text?: {
    type: 'mrkdwn' | 'plain_text'
    text: string
    emoji?: boolean
  }
}

export interface CustomerProfileData {
  email: string
  name?: string
  products: string[]
  lifetimeValue: number
  supportStats: {
    totalTickets: number
    resolvedTickets: number
    lastContact?: Date
  }
}

export interface CustomerPurchaseSummary {
  productName: string
  purchasedAt?: Date
}

export interface CustomerHistoryItem {
  conversationId: string
  subject: string
  status: 'resolved' | 'open'
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

function formatMonthYear(date: Date): string {
  return date.toLocaleString('en-US', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

function formatRelativeDate(date: Date, now: Date): string {
  const deltaMs = Math.max(0, now.getTime() - date.getTime())
  const deltaDays = Math.max(1, Math.round(deltaMs / (1000 * 60 * 60 * 24)))
  if (deltaDays < 7) return `${deltaDays} day${deltaDays === 1 ? '' : 's'} ago`
  const weeks = Math.round(deltaDays / 7)
  if (weeks < 4) return `${weeks} week${weeks === 1 ? '' : 's'} ago`
  const months = Math.round(deltaDays / 30)
  return `${months} month${months === 1 ? '' : 's'} ago`
}

export function formatCustomerProfileBlocks(input: {
  profile: CustomerProfileData
  purchases: CustomerPurchaseSummary[]
  history: CustomerHistoryItem[]
  now: Date
}): { text: string; blocks: SlackBlock[] } {
  const { profile, purchases, history, now } = input
  const blocks: SlackBlock[] = [
    formatHeader('👤 *Customer Profile*'),
    { type: 'divider' },
    formatListSection(`*${profile.name ?? 'Customer'}*`, [profile.email]),
  ]

  const purchaseLines = purchases.length
    ? purchases.map((purchase) => {
        const dateLabel = purchase.purchasedAt
          ? ` (purchased ${formatMonthYear(purchase.purchasedAt)})`
          : ''
        return `• ${purchase.productName}${dateLabel}`
      })
    : ['• No purchases found.']

  blocks.push(formatListSection('📦 *Products*', purchaseLines))

  const statsLines = [
    `• Total tickets: ${profile.supportStats.totalTickets}`,
    `• Resolved tickets: ${profile.supportStats.resolvedTickets}`,
  ]

  if (profile.supportStats.lastContact) {
    statsLines.push(
      `• Last contact: ${formatRelativeDate(
        profile.supportStats.lastContact,
        now
      )}`
    )
  } else {
    statsLines.push('• Last contact: —')
  }

  blocks.push(formatListSection('📊 *Support History*', statsLines))

  const historyLines = history.length
    ? history.map((item, index) => {
        const statusLabel =
          item.status === 'resolved' ? 'Resolved ✅' : 'Open ⏳'
        const link = buildFrontLink(item.conversationId)
        return `${index + 1}. ${item.subject} — ${statusLabel} <${link}|View>`
      })
    : ['• No recent tickets.']

  blocks.push(formatListSection('Recent tickets:', historyLines))

  return {
    text: `Customer profile for ${profile.email}`,
    blocks,
  }
}

export function formatCustomerHistoryBlocks(input: {
  email: string
  history: CustomerHistoryItem[]
}): { text: string; blocks: SlackBlock[] } {
  const lines = input.history.length
    ? input.history.map((item) => {
        const statusLabel =
          item.status === 'resolved' ? 'Resolved ✅' : 'Open ⏳'
        const link = buildFrontLink(item.conversationId)
        return `• ${item.subject} — ${statusLabel} <${link}|View>`
      })
    : ['• No prior conversations found.']

  const blocks: SlackBlock[] = [
    formatHeader('🗂️ *Customer History*'),
    { type: 'divider' },
    formatListSection(`History for ${input.email}`, lines),
  ]

  return {
    text: input.history.length
      ? `History for ${input.email}`
      : `No prior conversations for ${input.email}`,
    blocks,
  }
}

export function formatCustomerPurchasesBlocks(input: {
  email: string
  purchases: CustomerPurchaseSummary[]
}): { text: string; blocks: SlackBlock[] } {
  const lines = input.purchases.length
    ? input.purchases.map((purchase) => {
        const dateLabel = purchase.purchasedAt
          ? ` (purchased ${formatMonthYear(purchase.purchasedAt)})`
          : ''
        return `• ${purchase.productName}${dateLabel}`
      })
    : ['• No purchases found.']

  const blocks: SlackBlock[] = [
    formatHeader('📦 *Customer Purchases*'),
    { type: 'divider' },
    formatListSection(`Purchases for ${input.email}`, lines),
  ]

  return {
    text: input.purchases.length
      ? `Purchases for ${input.email}`
      : `No purchases found for ${input.email}`,
    blocks,
  }
}
