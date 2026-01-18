/**
 * Escapes special regex characters in a string for safe use in RegExp constructor.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Redacts personally identifiable information (PII) from text.
 *
 * Redacts:
 * - Email addresses → [EMAIL]
 * - Phone numbers (various formats) → [PHONE]
 * - Credit card numbers → [CARD]
 * - Known names (case insensitive) → [NAME]
 *
 * @param text - The text to redact PII from
 * @param knownNames - Array of names to redact (optional)
 * @returns The text with PII redacted
 *
 * @example
 * ```ts
 * redactPII('Contact john@example.com at 555-1234')
 * // Returns: 'Contact [EMAIL] at [PHONE]'
 *
 * redactPII('Hello Alice', ['Alice'])
 * // Returns: 'Hello [NAME]'
 * ```
 */
export function redactPII(text: string, knownNames: string[] = []): string {
  let redacted = text
    // Email pattern
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[EMAIL]')
    // Credit card pattern - must run before phone to avoid conflicts
    // Matches 16 digits with optional separators (-, space, or none)
    .replace(/\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g, '[CARD]')
    // Phone pattern - matches various formats
    .replace(
      /(\+?1[-.\s]?)?\(?[0-9]{3}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}/g,
      '[PHONE]'
    )

  // Redact known names (case insensitive)
  if (knownNames.length > 0) {
    redacted = redacted.replace(
      new RegExp(knownNames.map(escapeRegex).join('|'), 'gi'),
      '[NAME]'
    )
  }

  return redacted
}
