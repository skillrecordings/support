import fs from 'fs'
import path from 'path'

const DATA_PATH = '/home/joel/Code/skillrecordings/support/packages/cli/data/merged-conversations.json'
const OUTPUT_SQL = path.resolve('scripts/classify-conversations.sql')
const REPORT_PATH = path.resolve('reports/classification-distribution.json')
const CLASSIFIER_VERSION = 'heuristic-v1'
const BATCH_SIZE = 50

const TAXONOMY = [
  'support_access',
  'support_refund',
  'support_transfer',
  'support_technical',
  'support_billing',
  'presales_faq',
  'presales_consult',
  'presales_team',
  'fan_mail',
  'spam',
  'system',
  'voc_response',
]

const categoryMap = new Map([
  ['access', 'support_access'],
  ['refund', 'support_refund'],
  ['transfer', 'support_transfer'],
  ['billing', 'support_billing'],
  ['technical', 'support_technical'],
  ['business', 'presales_team'],
])

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
  refund: ['refund', 'money back', 'cancel order', 'cancel my', 'chargeback'],
  transfer: ['transfer', 'change email', 'update email', 'email change', 'lost license'],
  access: ['access', 'login', 'log in', 'password', 'license', 'account', 'sign in'],
  billing: [
    'invoice',
    'receipt',
    'billing',
    'tax',
    'vat',
    'charge',
    'payment',
    'card',
    'pricing',
    'price',
    'cost',
    'discount',
    'coupon',
    'student discount',
    'ppp',
  ],
  technical: ['error', 'issue', 'bug', 'problem', 'lesson', 'video', 'playback', 'typescript', 'code'],
  presalesTeam: ['team', 'enterprise', 'bulk', 'seats', 'company', 'purchase order', 'po', 'site license'],
  presalesConsult: ['which course', 'recommend', 'should i buy', 'right for me', 'career', 'path'],
  presalesFaq: [
    'curriculum',
    'modules',
    'what\'s included',
    'what is included',
    'how much',
    'price',
    'cost',
    'discount',
    'student',
    'ppp',
    'prerequisite',
    'requirements',
    'bundle',
  ],
  praise: ['thank you', 'thanks', 'appreciate', 'love your', 'amazing', 'great work', 'awesome', 'fantastic'],
  purchaseEvidence: [
    'purchased',
    'purchase',
    'bought',
    'order',
    'receipt',
    'invoice',
    'charged',
    'payment',
    'license',
  ],
  presalesIntent: ['considering', 'thinking of buying', 'before i buy', 'interested in', 'looking to buy'],
}

function normalize(text) {
  return (text || '').toLowerCase()
}

function hasAny(text, keywords) {
  return keywords.some((keyword) => text.includes(keyword))
}

function hasQuotedLines(text) {
  return /(^|\n)\s*>/.test(text)
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

function classifyItem(item) {
  const rawText = buildText(item)
  const text = normalize(rawText)
  const subject = normalize(item.subject || '')
  const tags = (item.tags || []).map((tag) => tag.toLowerCase())

  const hasQuestion = text.includes('?')
  const hasPurchaseEvidence = hasAny(text, keywordSets.purchaseEvidence)
  const hasPresalesIntent = hasAny(text, keywordSets.presalesIntent)

  const isSystem =
    hasAny(text, keywordSets.system) ||
    hasAny(subject, keywordSets.system) ||
    tags.includes('ad') ||
    subject.includes('dmarc digest')

  if (isSystem) {
    return { request_type: 'system', confidence: 0.95 }
  }

  const isSpam =
    hasAny(text, keywordSets.spam) ||
    hasAny(subject, keywordSets.spam) ||
    tags.includes('ad') ||
    tags.includes('collaboration')

  if (isSpam) {
    return { request_type: 'spam', confidence: 0.9 }
  }

  const isVocResponse =
    hasQuotedLines(rawText) ||
    hasAny(text, keywordSets.voc) ||
    hasAny(subject, keywordSets.voc) ||
    subject.includes('re: a quick question') ||
    subject.includes('re: hey there')

  if (isVocResponse) {
    return { request_type: 'voc_response', confidence: 0.85 }
  }

  const isPurePraise =
    hasAny(text, keywordSets.praise) &&
    !hasQuestion &&
    !hasPurchaseEvidence &&
    !hasPresalesIntent &&
    !hasAny(text, keywordSets.presalesConsult) &&
    !hasAny(text, keywordSets.presalesFaq)

  if (isPurePraise) {
    return { request_type: 'fan_mail', confidence: 0.8 }
  }

  const mappedCategory = categoryMap.get(item.category || '')
  if (mappedCategory) {
    return { request_type: mappedCategory, confidence: 0.9 }
  }

  if (hasAny(text, keywordSets.refund) || tags.includes('refund request')) {
    return { request_type: 'support_refund', confidence: 0.85 }
  }

  if (hasAny(text, keywordSets.transfer) || tags.includes('email transfer')) {
    return { request_type: 'support_transfer', confidence: 0.8 }
  }

  if (hasAny(text, keywordSets.access) || tags.includes('delete account') || tags.includes('lost license')) {
    return { request_type: 'support_access', confidence: 0.75 }
  }

  if (hasAny(text, keywordSets.billing) || tags.includes('student discount') || tags.includes('discount extension')) {
    return { request_type: hasPurchaseEvidence ? 'support_billing' : 'presales_faq', confidence: 0.7 }
  }

  if (hasAny(text, keywordSets.technical) || tags.includes('playback issues')) {
    return { request_type: 'support_technical', confidence: 0.7 }
  }

  if (hasAny(text, keywordSets.presalesTeam)) {
    return { request_type: 'presales_team', confidence: 0.65 }
  }

  if (hasAny(text, keywordSets.presalesConsult)) {
    return { request_type: 'presales_consult', confidence: 0.6 }
  }

  if (hasAny(text, keywordSets.presalesFaq) || hasPresalesIntent) {
    return { request_type: 'presales_faq', confidence: 0.6 }
  }

  const fallback = item.category === 'feedback' ? 'presales_consult' : 'support_technical'
  return { request_type: fallback, confidence: 0.5 }
}

function assertTaxonomy(requestType) {
  if (!TAXONOMY.includes(requestType)) {
    throw new Error(`Invalid request_type: ${requestType}`)
  }
}

const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'))
const classifications = data.map((item) => {
  const classification = classifyItem(item)
  assertTaxonomy(classification.request_type)
  return {
    conversation_id: item.id,
    request_type: classification.request_type,
    confidence: classification.confidence,
  }
})

const distribution = classifications.reduce((acc, row) => {
  acc[row.request_type] = (acc[row.request_type] || 0) + 1
  return acc
}, {})

fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true })
fs.writeFileSync(REPORT_PATH, JSON.stringify({ total: classifications.length, distribution }, null, 2))

const sqlLines = [
  'BEGIN TRANSACTION;',
  'DELETE FROM classifications;',
]

for (let i = 0; i < classifications.length; i += BATCH_SIZE) {
  const batch = classifications.slice(i, i + BATCH_SIZE)
  const values = batch
    .map((row) => {
      const id = row.conversation_id.replace(/'/g, "''")
      const type = row.request_type.replace(/'/g, "''")
      return `('${id}', '${type}', ${row.confidence}, '${CLASSIFIER_VERSION}')`
    })
    .join(',\n')
  sqlLines.push(`INSERT INTO classifications (conversation_id, request_type, confidence, classifier_version) VALUES\n${values};`)
}

sqlLines.push('COMMIT;')
fs.writeFileSync(OUTPUT_SQL, `${sqlLines.join('\n')}\n`)

console.log(`Wrote ${classifications.length} classifications to ${OUTPUT_SQL}`)
console.log(`Distribution report saved to ${REPORT_PATH}`)
