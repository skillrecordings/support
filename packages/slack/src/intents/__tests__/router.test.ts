import { describe, expect, it } from 'vitest'
import { HELP_RESPONSE, routeIntent } from '../router'

describe('routeIntent', () => {
  it('classifies status queries', () => {
    const { intent, response } = routeIntent('anything urgent?')

    expect(intent.category).toBe('status_query')
    expect(intent.confidence).toBeGreaterThan(0.7)
    expect(intent.rawText).toBe('anything urgent?')
    expect(response).toContain('status')
  })

  it('classifies draft actions', () => {
    const { intent } = routeIntent('approve and send')

    expect(intent.category).toBe('draft_action')
    expect(intent.confidence).toBeGreaterThan(0.7)
  })

  it('classifies context lookups with email extraction', () => {
    const { intent } = routeIntent('history with customer@example.com')

    expect(intent.category).toBe('context_lookup')
    expect(intent.entities.email).toBe('customer@example.com')
  })

  it('classifies escalations with name extraction', () => {
    const { intent } = routeIntent('escalate to Jane Doe')

    expect(intent.category).toBe('escalation')
    expect(intent.entities.name).toBe('Jane Doe')
  })

  it('returns help response for unknown intents', () => {
    const { intent, response } = routeIntent('ping me later')

    expect(intent.category).toBe('unknown')
    expect(response).toBe(HELP_RESPONSE)
  })

  it('handles empty mentions as unknown', () => {
    const { intent, response } = routeIntent('   ')

    expect(intent.category).toBe('unknown')
    expect(response).toBe(HELP_RESPONSE)
  })
})
