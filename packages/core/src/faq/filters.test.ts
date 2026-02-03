/**
 * Tests for FAQ preprocessing filters
 *
 * @module faq/filters.test
 */

import { describe, expect, it } from 'vitest'
import {
  createFilterStats,
  isAutoReply,
  isLessonComment,
  isNoiseSenderDomain,
  isServiceNotification,
  isSpam,
  shouldFilter,
  updateFilterStats,
} from './filters'

describe('isNoiseSenderDomain', () => {
  it('filters CastingWords', () => {
    expect(isNoiseSenderDomain('notify@castingwords.com')).toBe(true)
  })

  it('filters Google domains', () => {
    expect(isNoiseSenderDomain('calendar@google.com')).toBe(true)
    expect(isNoiseSenderDomain('noreply@googlemail.com')).toBe(true)
  })

  it('filters cloud service domains', () => {
    expect(isNoiseSenderDomain('alerts@vercel.com')).toBe(true)
    expect(isNoiseSenderDomain('status@cloudinary.com')).toBe(true)
    expect(isNoiseSenderDomain('noreply@mux.com')).toBe(true)
  })

  it('allows customer domains', () => {
    expect(isNoiseSenderDomain('user@gmail.com')).toBe(false)
    expect(isNoiseSenderDomain('customer@example.com')).toBe(false)
  })

  it('handles invalid emails', () => {
    expect(isNoiseSenderDomain('notanemail')).toBe(false)
    expect(isNoiseSenderDomain('')).toBe(false)
  })
})

describe('isAutoReply', () => {
  it('detects Chinese QQ auto-replies', () => {
    expect(
      isAutoReply('这是来自QQ邮箱的假期自动回复邮件。您好，我最近正在休假中')
    ).toBe(true)
    // The "你好，我已收到您的邮件" pattern is already covered by "您好.*我已收到您的邮件" with reversed order
    expect(isAutoReply('您好，我已收到您的邮件')).toBe(true)
  })

  it('detects English auto-replies', () => {
    expect(
      isAutoReply(
        'This is an automatic reply. I am out of office until Monday.'
      )
    ).toBe(true)
    expect(
      isAutoReply('Vacation auto-reply: I will respond when I return.')
    ).toBe(true)
  })

  it('detects calendar notifications', () => {
    expect(isAutoReply('Jacob Fifhause has accepted this invitation.')).toBe(
      true
    )
    expect(isAutoReply('Workshop invitation from Google Calendar')).toBe(true)
  })

  it('detects Mixmax auto-responses', () => {
    expect(
      isAutoReply('The recipient uses Mixmax to route first-time outreach')
    ).toBe(true)
  })

  it('allows normal messages', () => {
    expect(isAutoReply('Hi, I need help with my account')).toBe(false)
  })
})

describe('isSpam', () => {
  it('detects Head AI outreach', () => {
    expect(
      isSpam("I'm reaching out from Head, an AI-powered influencer agency")
    ).toBe(true)
    expect(isSpam('Francis, Partnerships at Head Creator')).toBe(true)
  })

  it('allows normal messages', () => {
    expect(isSpam('Hi, I have a question about my purchase')).toBe(false)
  })
})

describe('isLessonComment', () => {
  it('detects egghead lesson comments', () => {
    const comment = `Wayne [EMAIL] writes:
Is that WallabyJS in your IDE?! :)
--- lesson: Write Reducers for Different Data Types : https://egghead.io/lessons/...`
    expect(isLessonComment(comment)).toBe(true)
  })

  it('allows normal messages', () => {
    expect(isLessonComment('Hi, I have a question about the course')).toBe(
      false
    )
  })
})

describe('isServiceNotification', () => {
  it('detects CastingWords notifications', () => {
    expect(
      isServiceNotification(
        'Hi Total, We\'ve just finished your transcription, "31 as const"'
      )
    ).toBe(true)
  })

  it('detects DMARC reports', () => {
    expect(
      isServiceNotification(
        '39,370 emails were sent using totaltypescript.com between Oct 07 and Oct 13. 98.6% were DMARC aligned.'
      )
    ).toBe(true)
  })

  it('detects payment notifications', () => {
    expect(
      isServiceNotification(
        'Your payment was successful. We received your payment of $283.94.'
      )
    ).toBe(true)
  })

  it('detects Google Workspace invoices', () => {
    expect(
      isServiceNotification(
        'Google Workspace Your Google Workspace monthly invoice is available'
      )
    ).toBe(true)
  })

  it('detects sign-in notifications', () => {
    expect(
      isServiceNotification(
        'We noticed a new sign-in to your Google Account on a Mac device.'
      )
    ).toBe(true)
  })

  it('allows customer messages', () => {
    expect(isServiceNotification('Hi, I need an invoice for my purchase')).toBe(
      false
    )
  })
})

describe('shouldFilter', () => {
  it('filters by sender domain first', () => {
    const result = shouldFilter('Any message', 'notify@castingwords.com')
    expect(result.filtered).toBe(true)
    expect(result.reason).toBe('sender_domain')
  })

  it('filters lesson comments', () => {
    const comment = `Wayne wayne@example.com writes:
Is that WallabyJS?
--- lesson: https://egghead.io/lessons/...`
    const result = shouldFilter(comment)
    expect(result.filtered).toBe(true)
    expect(result.reason).toBe('lesson_comment')
  })

  it('filters auto-replies', () => {
    const result = shouldFilter('这是来自QQ邮箱的假期自动回复邮件')
    expect(result.filtered).toBe(true)
    expect(result.reason).toBe('auto_reply')
  })

  it('filters spam', () => {
    const result = shouldFilter(
      "I'm reaching out from Head, an AI-powered influencer agency"
    )
    expect(result.filtered).toBe(true)
    expect(result.reason).toBe('spam')
  })

  it('filters service notifications', () => {
    const result = shouldFilter("We've just finished your transcription")
    expect(result.filtered).toBe(true)
    expect(result.reason).toBe('service_notification')
  })

  it('passes legitimate support messages', () => {
    const result = shouldFilter(
      'Hi, I would like to request a refund for my purchase',
      'customer@example.com'
    )
    expect(result.filtered).toBe(false)
    expect(result.reason).toBeUndefined()
  })
})

describe('FilterStats', () => {
  it('tracks filter results correctly', () => {
    const stats = createFilterStats()

    updateFilterStats(stats, { filtered: true, reason: 'spam' })
    updateFilterStats(stats, { filtered: true, reason: 'spam' })
    updateFilterStats(stats, { filtered: true, reason: 'auto_reply' })
    updateFilterStats(stats, { filtered: false })
    updateFilterStats(stats, { filtered: false })

    expect(stats.total).toBe(5)
    expect(stats.filtered).toBe(3)
    expect(stats.passed).toBe(2)
    expect(stats.byReason['spam']).toBe(2)
    expect(stats.byReason['auto_reply']).toBe(1)
  })
})
