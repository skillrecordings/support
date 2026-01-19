import type { Rule } from './types'

/**
 * System rules for filtering non-customer messages.
 *
 * These rules run at priority 0 (highest) to short-circuit
 * before any customer-facing logic executes.
 *
 * All rules use action: 'no_respond' to silently skip processing.
 */
export const systemRules: Rule[] = [
  // Bounce notifications
  {
    id: 'sys-mailer-daemon',
    priority: 0,
    type: 'sender_pattern',
    pattern: 'mailer-daemon@*',
    action: 'no_respond',
  },
  {
    id: 'sys-postmaster',
    priority: 0,
    type: 'sender_pattern',
    pattern: 'postmaster@*',
    action: 'no_respond',
  },
  {
    id: 'sys-mail-delivery',
    priority: 0,
    type: 'sender_pattern',
    pattern: 'mail-delivery*@*',
    action: 'no_respond',
  },

  // Auto-reply/noreply addresses
  {
    id: 'sys-noreply',
    priority: 0,
    type: 'sender_pattern',
    pattern: 'noreply@*',
    action: 'no_respond',
  },
  {
    id: 'sys-no-reply',
    priority: 0,
    type: 'sender_pattern',
    pattern: 'no-reply@*',
    action: 'no_respond',
  },
  {
    id: 'sys-donotreply',
    priority: 0,
    type: 'sender_pattern',
    pattern: 'donotreply@*',
    action: 'no_respond',
  },
  {
    id: 'sys-do-not-reply',
    priority: 0,
    type: 'sender_pattern',
    pattern: 'do-not-reply@*',
    action: 'no_respond',
  },

  // AWS notifications
  {
    id: 'sys-aws-notifications',
    priority: 0,
    type: 'sender_domain',
    pattern: '*.amazonaws.com',
    action: 'no_respond',
  },
  {
    id: 'sys-aws-health',
    priority: 0,
    type: 'sender_pattern',
    pattern: '*@health.aws',
    action: 'no_respond',
  },

  // Common notification senders
  {
    id: 'sys-notifications',
    priority: 0,
    type: 'sender_pattern',
    pattern: 'notifications@*',
    action: 'no_respond',
  },
  {
    id: 'sys-alerts',
    priority: 0,
    type: 'sender_pattern',
    pattern: 'alerts@*',
    action: 'no_respond',
  },

  // Calendar/meeting invites
  {
    id: 'sys-calendar',
    priority: 0,
    type: 'sender_pattern',
    pattern: 'calendar-notification@*',
    action: 'no_respond',
  },

  // GitHub notifications
  {
    id: 'sys-github',
    priority: 0,
    type: 'sender_domain',
    pattern: 'github.com',
    action: 'no_respond',
  },

  // LinkedIn
  {
    id: 'sys-linkedin',
    priority: 0,
    type: 'sender_domain',
    pattern: '*.linkedin.com',
    action: 'no_respond',
  },

  // Content-based: out-of-office auto-replies
  {
    id: 'sys-ooo-subject',
    priority: 1,
    type: 'keyword',
    pattern: 'out of office|automatic reply|auto-reply|autoreply',
    action: 'no_respond',
  },

  // Content-based: delivery failure notifications
  {
    id: 'sys-delivery-failure',
    priority: 1,
    type: 'keyword',
    pattern:
      'delivery status notification|undeliverable|failed to deliver|message not delivered',
    action: 'no_respond',
  },
]

/**
 * Merge system rules with app-specific rules.
 * System rules always run first (priority 0).
 */
export function mergeWithSystemRules(appRules: Rule[]): Rule[] {
  return [...systemRules, ...appRules]
}
