/**
 * FAQ Preprocessing Filters
 *
 * Filters to remove noise before clustering. These patterns were identified
 * by auditing Phase 0 cluster quality (see docs/cluster-quality-diagnosis.md).
 *
 * Issue: #110
 *
 * @module faq/filters
 */

/**
 * Sender domains that should be filtered out before clustering.
 * These are service providers, not customer support requests.
 */
export const NOISE_SENDER_DOMAINS = [
  // Transcription services
  'castingwords.com',

  // Email/Marketing services
  'postmarkapp.com',
  'convertkit.com',
  'kit.com',
  'kit-mail6.com',
  'convertkit-mail4.com',
  'mailgun.org',
  'sendgrid.net',

  // Cloud services
  'algolia.com',
  'cloudinary.com',
  'mux.com',
  'aws.amazon.com',
  'amazonaws.com',
  'vercel.com',

  // Google services
  'google.com',
  'google.co.uk',
  'googlemail.com',

  // Payment/Billing
  'stripe.com',
  'paddle.com',

  // Training/Enterprise platforms
  'placedelaformation.com',
  'allwyn-lotterysolutions.com',
  'atlassian.net',

  // Email routing/filtering
  'mixmax.com',

  // Security/DMARC
  'dmarc.postmarkapp.com',
  'postmarkdmarc.com',
  'activecampaign.com',
] as const

/**
 * Auto-reply patterns that indicate noise, not real support requests.
 */
export const AUTO_REPLY_PATTERNS = [
  // Chinese auto-replies
  /这是.*自动回复/,
  /[你您]好.*我已收到您的邮件/,
  /我已收到您的邮件/,
  /您的邮件我已经收到/,
  /我最近正在休假中/,

  // English auto-replies
  /vacation.*auto.*reply/i,
  /out of office/i,
  /automatic reply/i,
  /auto-reply/i,

  // Calendar notifications
  /has accepted this invitation/i,
  /has declined this invitation/i,
  /invitation from google calendar/i,

  // Email routing tools
  /uses Mixmax to route/i,
  /keeping their inbox clear/i,

  // Service desk auto-responses
  /just confirming that we got your request/i,
  /reply above this line/i,

  // Unsubscribe confirmations
  /you have been unsubscribed/i,
  /successfully unsubscribed/i,
] as const

/**
 * Spam/outreach patterns - cold emails to support addresses
 */
export const SPAM_PATTERNS = [
  // Influencer outreach (Head AI)
  /reaching out from Head/i,
  /AI-powered influencer/i,
  /Partnerships at Head Creator/i,

  // Generic cold outreach
  /I hope this email finds you well.*My name is/i,
  /I'd like to discuss a partnership/i,
  /collaboration opportunity/i,

  // SEO spam
  /increase your organic traffic/i,
  /boost your SEO/i,
  /backlink opportunity/i,
] as const

/**
 * Lesson comment pattern - these are egghead lesson comments, not support
 */
export const LESSON_COMMENT_PATTERN = /^.*writes:[\s\S]*---\s*lesson:/i

/**
 * Service notification patterns - automated emails from service providers
 */
export const SERVICE_NOTIFICATION_PATTERNS = [
  // Transcription services
  /We've just finished your transcription/i,
  /We just finished up transcribing order/i,

  // DMARC/Email reports
  /emails were sent using.*between/i,
  /DMARC Compliance/i,
  /DMARC aligned/i,
  /dmarc.postmarkapp.com/i,

  // Usage reports
  /Weekly report.*Plan usage/i,
  /Usage Report/i,
  /monthly invoice is available/i,

  // Payment notifications
  /Your payment was successful/i,
  /We received your payment/i,

  // Security notifications
  /new sign-in.*device/i,
  /unrecognized device/i,
  /We found some security gaps/i,

  // Google Workspace
  /Google Workspace.*invoice/i,
  /Google Analytics.*tips/i,
  /Dear Administrator/i,
] as const

/**
 * Marketing reply indicators - replies to outbound marketing emails
 */
export const MARKETING_REPLY_PATTERNS = [
  // Price objection replies (from TotalTypeScript campaigns)
  /What's holding you back from buying/i,
  /Total TypeScript Core Volume Pre-Release/i,
  /workshop.*discount.*limited time/i,
] as const

/**
 * Check if a message should be filtered based on sender domain.
 */
export function isNoiseSenderDomain(email: string): boolean {
  const domain = email.split('@')[1]?.toLowerCase() ?? ''
  return NOISE_SENDER_DOMAINS.some(
    (noiseDomain) =>
      domain === noiseDomain || domain.endsWith(`.${noiseDomain}`)
  )
}

/**
 * Check if a message matches any auto-reply pattern.
 */
export function isAutoReply(text: string): boolean {
  return AUTO_REPLY_PATTERNS.some((pattern) => pattern.test(text))
}

/**
 * Check if a message matches any spam/outreach pattern.
 */
export function isSpam(text: string): boolean {
  return SPAM_PATTERNS.some((pattern) => pattern.test(text))
}

/**
 * Check if a message is an egghead lesson comment.
 */
export function isLessonComment(text: string): boolean {
  return LESSON_COMMENT_PATTERN.test(text)
}

/**
 * Check if a message is a service notification.
 */
export function isServiceNotification(text: string): boolean {
  return SERVICE_NOTIFICATION_PATTERNS.some((pattern) => pattern.test(text))
}

/**
 * Check if a message is a reply to a marketing email.
 * These are detected by checking if the quoted/forwarded content matches marketing patterns.
 */
export function isMarketingReply(text: string): boolean {
  return MARKETING_REPLY_PATTERNS.some((pattern) => pattern.test(text))
}

/**
 * Filter result with reason for transparency/debugging.
 */
export interface FilterResult {
  /** Whether the message should be filtered */
  filtered: boolean
  /** Reason for filtering (if filtered) */
  reason?:
    | 'sender_domain'
    | 'auto_reply'
    | 'spam'
    | 'lesson_comment'
    | 'service_notification'
    | 'marketing_reply'
}

/**
 * Check if a message should be filtered before clustering.
 *
 * @param text - Message text
 * @param senderEmail - Sender email address
 * @returns FilterResult with filtered status and reason
 */
export function shouldFilter(text: string, senderEmail?: string): FilterResult {
  // Check sender domain first (cheapest check)
  if (senderEmail && isNoiseSenderDomain(senderEmail)) {
    return { filtered: true, reason: 'sender_domain' }
  }

  // Check lesson comment pattern
  if (isLessonComment(text)) {
    return { filtered: true, reason: 'lesson_comment' }
  }

  // Check auto-reply patterns
  if (isAutoReply(text)) {
    return { filtered: true, reason: 'auto_reply' }
  }

  // Check spam patterns
  if (isSpam(text)) {
    return { filtered: true, reason: 'spam' }
  }

  // Check service notification patterns
  if (isServiceNotification(text)) {
    return { filtered: true, reason: 'service_notification' }
  }

  // Don't filter marketing replies by default - they might still be useful
  // for understanding customer objections, just not for FAQ extraction
  // Uncomment to enable:
  // if (isMarketingReply(text)) {
  //   return { filtered: true, reason: 'marketing_reply' }
  // }

  return { filtered: false }
}

/**
 * Filter statistics for logging/monitoring.
 */
export interface FilterStats {
  total: number
  filtered: number
  passed: number
  byReason: Record<string, number>
}

/**
 * Create empty filter stats.
 */
export function createFilterStats(): FilterStats {
  return {
    total: 0,
    filtered: 0,
    passed: 0,
    byReason: {},
  }
}

/**
 * Update filter stats with a result.
 */
export function updateFilterStats(
  stats: FilterStats,
  result: FilterResult
): void {
  stats.total++
  if (result.filtered) {
    stats.filtered++
    if (result.reason) {
      stats.byReason[result.reason] = (stats.byReason[result.reason] ?? 0) + 1
    }
  } else {
    stats.passed++
  }
}

/**
 * Format filter stats for display.
 */
export function formatFilterStats(stats: FilterStats): string {
  const lines = [
    `📊 Filter Statistics:`,
    `   Total processed: ${stats.total}`,
    `   Filtered out:    ${stats.filtered} (${((stats.filtered / stats.total) * 100).toFixed(1)}%)`,
    `   Passed:          ${stats.passed} (${((stats.passed / stats.total) * 100).toFixed(1)}%)`,
  ]

  if (Object.keys(stats.byReason).length > 0) {
    lines.push(`   By reason:`)
    for (const [reason, count] of Object.entries(stats.byReason).sort(
      (a, b) => b[1] - a[1]
    )) {
      lines.push(`     - ${reason}: ${count}`)
    }
  }

  return lines.join('\n')
}
