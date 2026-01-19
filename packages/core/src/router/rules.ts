import type { Rule, RuleMatch } from './types'

export type { Rule, RuleMatch }

/**
 * Match incoming message and sender against rules.
 *
 * Rules are evaluated in priority order (lower number = higher priority).
 * Returns the first matching rule or null if no rules match.
 *
 * Supports three rule types:
 * - `regex`: Match message content using regular expressions (case insensitive)
 * - `keyword`: Match message content using keywords or keyword lists (case insensitive)
 * - `sender_domain`: Match sender email domain (supports wildcards like *.example.com)
 *
 * @param message - The message content to match against
 * @param sender - The sender email address
 * @param rules - Array of rules to evaluate
 * @returns Matching rule with action details, or null if no match
 *
 * @example
 * ```typescript
 * const rules: Rule[] = [
 *   {
 *     id: 'refund-escalation',
 *     priority: 1,
 *     type: 'keyword',
 *     pattern: 'refund|cancel',
 *     action: 'escalate'
 *   }
 * ]
 *
 * const match = matchRules('I want a refund', 'user@example.com', rules)
 * // => { ruleId: 'refund-escalation', action: 'escalate', ... }
 * ```
 */
export function matchRules(
  message: string,
  sender: string,
  rules: Rule[]
): RuleMatch | null {
  if (rules.length === 0) {
    return null
  }

  // Sort by priority (lower number = higher priority)
  const sortedRules = [...rules].sort((a, b) => a.priority - b.priority)

  for (const rule of sortedRules) {
    const matches = matchRule(rule, message, sender)
    if (matches) {
      return {
        ruleId: rule.id,
        action: rule.action,
        response: rule.response,
        cannedResponseId: rule.cannedResponseId,
      }
    }
  }

  return null
}

/**
 * Check if a single rule matches the message/sender.
 */
function matchRule(rule: Rule, message: string, sender: string): boolean {
  switch (rule.type) {
    case 'regex':
      return matchRegex(rule.pattern, message)
    case 'keyword':
      return matchKeyword(rule.pattern, message)
    case 'sender_domain':
      return matchSenderDomain(rule.pattern, sender)
    case 'sender_pattern':
      return matchSenderPattern(rule.pattern, sender)
    default:
      return false
  }
}

/**
 * Match regex pattern against message (case insensitive).
 */
function matchRegex(pattern: string, message: string): boolean {
  try {
    const regex = new RegExp(pattern, 'i')
    return regex.test(message)
  } catch {
    // Invalid regex - don't match
    return false
  }
}

/**
 * Match keyword(s) against message (case insensitive).
 * Pattern can contain multiple keywords separated by | (OR).
 */
function matchKeyword(pattern: string, message: string): boolean {
  const lowerMessage = message.toLowerCase()
  const lowerPattern = pattern.toLowerCase()

  // If pattern contains |, it's an OR operation
  if (lowerPattern.includes('|')) {
    const keywords = lowerPattern.split('|').map((k) => k.trim())
    return keywords.some((keyword) => lowerMessage.includes(keyword))
  }

  return lowerMessage.includes(lowerPattern)
}

/**
 * Match sender domain pattern.
 * Supports exact domain matching and wildcard subdomain (*.example.com).
 */
function matchSenderDomain(pattern: string, sender: string): boolean {
  // Extract domain from email address
  const emailMatch = sender.match(/@(.+)$/)
  if (!emailMatch || !emailMatch[1]) {
    return false
  }

  const senderDomain = emailMatch[1].toLowerCase()
  const lowerPattern = pattern.toLowerCase()

  // Wildcard subdomain matching (*.example.com)
  if (lowerPattern.startsWith('*.')) {
    const baseDomain = lowerPattern.slice(2)
    return senderDomain.endsWith(baseDomain)
  }

  // Exact domain matching
  return senderDomain === lowerPattern
}

/**
 * Match sender email against a pattern (case insensitive).
 * Supports wildcards: * matches any characters.
 * Example: "mailer-daemon@*" matches "mailer-daemon@googlemail.com"
 */
function matchSenderPattern(pattern: string, sender: string): boolean {
  const lowerSender = sender.toLowerCase()
  const lowerPattern = pattern.toLowerCase()

  // Convert wildcard pattern to regex
  // Escape regex special chars except *, then replace * with .*
  const regexPattern = lowerPattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')

  try {
    const regex = new RegExp(`^${regexPattern}$`, 'i')
    return regex.test(lowerSender)
  } catch {
    return false
  }
}
