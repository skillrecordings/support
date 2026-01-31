import fs from 'fs'
import path from 'path'

const DATA_PATH = '/home/joel/Code/skillrecordings/support/packages/cli/data/merged-conversations.json'
const OUTPUT_SQL = path.resolve('scripts/score-conversations.sql')
const REPORT_PATH = path.resolve('reports/quality-distribution.json')
const BATCH_SIZE = 50

const keywordSets = {
  system: [
    'auto-reply',
    'automatic reply',
    'delivery status notification',
    'mail delivery subsystem',
    'undeliverable',
    'out of office',
    'vacation reply',
    'dmarc digest',
    'has accepted this invitation',
    'calendar invitation',
    'invitation response',
    'do not reply',
    'noreply',
  ],
  spam: [
    'partnership',
    'affiliate',
    'commission',
    'collaboration',
    'sponsorship',
    'sponsor',
    'guest post',
    'backlink',
    'link building',
    'seo',
    'marketing agency',
    'advertis',
    'beta program',
    'press release',
    'paid collab',
    'promotion',
    'promote your',
    'saas',
    'influencer',
    'newsletter',
    'podcast',
  ],
  voc: [
    'a quick question',
    'what interests you about',
    'how can we help',
    'checking in',
    'feedback',
    'survey',
  ],
  praise: ['thank you', 'thanks', 'appreciate', 'love your', 'amazing', 'great work', 'awesome', 'fantastic'],
  resolutionCustomer: [
    'that worked',
    'works now',
    'working now',
    'fixed',
    'resolved',
    'all set',
    'perfect',
    'got it',
    'got it working',
    'thank you',
    'thanks',
    'appreciate',
  ],
  resolutionSupport: [
    'i have refunded',
    'i refunded',
    'refund has been processed',
    'refund processed',
    'i have transferred',
    'i transferred',
    'transfer complete',
    'updated your email',
    'updated the email',
    'reset your',
    'reset the',
    'sent you',
    'i have sent',
    'you should now',
    'you can now',
    'you are all set',
    "you're all set",
    'all set now',
  ],
  reusableSupport: [
    'here is',
    "here's",
    'you can',
    'please',
    'steps',
    'link',
    'refund',
    'transfer',
    'reset',
    'invoice',
    'receipt',
    'license',
    'access',
    'log in',
    'sign in',
  ],
  profanity: ['fuck', 'shit', 'bitch', 'asshole', 'dick', 'wtf', 'crap'],
  questionPrompts: [
    'how do i',
    'how can i',
    'can you',
    'could you',
    'please help',
    'i need',
    'i cannot',
    "i can't",
    'i am unable',
    'issue with',
    'problem with',
    'trouble',
    'help with',
  ],
}

const receiptMonths = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
]

function normalize(text) {
  return (text || '').toLowerCase()
}

function hasAny(text, keywords) {
  return keywords.some((keyword) => text.includes(keyword))
}

function stripQuoted(text) {
  if (!text) return ''
  const lines = text.split('\n')
  const cleaned = []
  for (const line of lines) {
    if (/^\s*>/.test(line)) continue
    if (/^On .*wrote:$/i.test(line) || /^On .*wrote:/i.test(line)) break
    cleaned.push(line)
  }
  return cleaned.join('\n')
}

function buildText(item) {
  const parts = [item.subject, item.triggerMessage?.body]
  if (Array.isArray(item.conversationHistory)) {
    for (const entry of item.conversationHistory) {
      parts.push(entry?.body)
    }
  }
  return parts.filter(Boolean).join('\n')
}

function classifyExclusion(item) {
  const rawText = buildText(item)
  const text = normalize(rawText)
  const subject = normalize(item.subject || '')
  const tags = (item.tags || []).map((tag) => tag.toLowerCase())
  const hasQuestion = text.includes('?')
  const receiptRegex = new RegExp(`\\byour\\s+(${receiptMonths.join('|')})\\s+receipt\\b`, 'i')

  const isSystem =
    hasAny(text, keywordSets.system) ||
    hasAny(subject, keywordSets.system) ||
    tags.includes('ad') ||
    subject.includes('dmarc digest')

  if (isSystem) return 'system'

  const isForwardedInvoice =
    text.includes('kit.com') ||
    text.includes('[EMAIL]') ||
    text.includes('convertkit.com') ||
    /@kit\.com\b/.test(text) ||
    /@convertkit\.com\b/.test(text) ||
    /your .* invoice for .*/i.test(subject) ||
    receiptRegex.test(text)

  if (isForwardedInvoice) return 'forwarded_invoice'

  const isSpam =
    hasAny(text, keywordSets.spam) ||
    hasAny(subject, keywordSets.spam) ||
    tags.includes('ad') ||
    tags.includes('collaboration')

  if (isSpam) return 'spam'

  const isPurePraise = hasAny(text, keywordSets.praise) && !hasQuestion
  if (isPurePraise) return 'fan_mail'

  return null
}

function scoreConversation(item) {
  const exclusion = classifyExclusion(item)
  if (exclusion) {
    return { score: 0, tier: 'noise', exclusion }
  }

  const history = Array.isArray(item.conversationHistory) ? item.conversationHistory : []
  const inbound = history.filter((entry) => entry.direction === 'in')
  const outbound = history.filter((entry) => entry.direction === 'out')

  const hasBidirectional = inbound.length > 0 && outbound.length > 0
  if (!hasBidirectional) {
    return { score: 0, tier: 'noise', exclusion: 'one_sided' }
  }

  const hasHumanOut = outbound.some((entry) => {
    const body = normalize(stripQuoted(entry.body || ''))
    if (!body) return false
    if (hasAny(body, keywordSets.system)) return false
    return body.length >= 40 || hasAny(body, keywordSets.reusableSupport)
  })

  const cleanedInbound = inbound.map((entry) => normalize(stripQuoted(entry.body || '')))
  const cleanedOutbound = outbound.map((entry) => normalize(stripQuoted(entry.body || '')))
  const totalInboundChars = cleanedInbound.join(' ').length
  const totalOutboundChars = cleanedOutbound.join(' ').length
  const hasQuestion = cleanedInbound.some(
    (body) => body.includes('?') || hasAny(body, keywordSets.questionPrompts),
  )
  const clearQna = hasQuestion || totalInboundChars >= 80

  const hasResolution = (() => {
    let lastOutIndex = -1
    history.forEach((entry, index) => {
      if (entry.direction === 'out') lastOutIndex = index
    })
    const inboundAfterOut = history.slice(lastOutIndex + 1).filter((entry) => entry.direction === 'in')
    const lastInbound = inboundAfterOut.length
      ? normalize(stripQuoted(inboundAfterOut[inboundAfterOut.length - 1].body || ''))
      : normalize(stripQuoted(inbound[inbound.length - 1]?.body || ''))

    if (lastInbound && hasAny(lastInbound, keywordSets.resolutionCustomer)) return true

    return cleanedOutbound.some((body) => hasAny(body, keywordSets.resolutionSupport))
  })()

  const lastMessage = history[history.length - 1]
  const awaitingCustomer =
    lastMessage?.direction === 'out' &&
    !hasResolution &&
    /\?|let me know|can you|could you|please|need|share/i.test(lastMessage.body || '')

  const hasReusablePattern = cleanedOutbound.some((body) => {
    if (!body) return false
    return body.length >= 120 || hasAny(body, keywordSets.reusableSupport)
  })

  const professionalTone = !hasAny(cleanedInbound.join(' '), keywordSets.profanity) &&
    !hasAny(cleanedOutbound.join(' '), keywordSets.profanity)
  const helpfulResponse = hasResolution || hasReusablePattern || totalOutboundChars >= 120

  let score = 0
  score += hasBidirectional ? 2 : 0
  score += hasHumanOut ? 1 : 0
  score += clearQna ? 1 : 0
  score += helpfulResponse ? 1 : 0
  score += totalInboundChars + totalOutboundChars >= 200 ? 1 : 0

  if (!professionalTone) score = Math.max(0, score - 1)
  if (!hasHumanOut) score = Math.min(score, 2)
  if (awaitingCustomer && !helpfulResponse) score = Math.min(score, 3)

  score = Math.max(0, Math.min(5, score))

  const isGold = hasHumanOut && clearQna && helpfulResponse
  const tier = isGold ? 'gold' : score >= 3 ? 'silver' : 'noise'
  const finalScore = isGold ? 5 : Math.min(score, 4)
  return { score: finalScore, tier }
}

const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'))
const exclusionCounts = {}
const scored = data.map((item) => {
  const result = scoreConversation(item)
  if (result.exclusion) {
    exclusionCounts[result.exclusion] = (exclusionCounts[result.exclusion] || 0) + 1
  }
  return {
    conversation_id: item.id,
    score: result.score,
    tier: result.tier,
  }
})

const tierCounts = scored.reduce(
  (acc, row) => {
    acc[row.tier] = (acc[row.tier] || 0) + 1
    return acc
  },
  { gold: 0, silver: 0, noise: 0 },
)

const avgScore = scored.reduce((sum, row) => sum + row.score, 0) / scored.length

fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true })
fs.writeFileSync(
  REPORT_PATH,
  JSON.stringify(
    {
      total: scored.length,
      averageScore: Number(avgScore.toFixed(2)),
      tiers: tierCounts,
      exclusions: exclusionCounts,
    },
    null,
    2,
  ),
)

const sqlLines = ['BEGIN TRANSACTION;']

for (let i = 0; i < scored.length; i += BATCH_SIZE) {
  const batch = scored.slice(i, i + BATCH_SIZE)
  for (const row of batch) {
    const id = row.conversation_id.replace(/'/g, "''")
    const isGold = row.score >= 5 ? 'TRUE' : 'FALSE'
    sqlLines.push(
      `UPDATE conversations SET quality_score = ${row.score}, is_gold = ${isGold} WHERE id = '${id}';`,
    )
  }
}

sqlLines.push('COMMIT;')
fs.writeFileSync(OUTPUT_SQL, `${sqlLines.join('\n')}\n`)

console.log(`Wrote ${scored.length} quality updates to ${OUTPUT_SQL}`)
console.log(`Quality distribution saved to ${REPORT_PATH}`)
if (exclusionCounts.forwarded_invoice) {
  console.log(`Forwarded invoice noise filtered: ${exclusionCounts.forwarded_invoice}`)
}
