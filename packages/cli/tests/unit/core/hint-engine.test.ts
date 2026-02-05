import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_HINT_RULES,
  type Hint,
  HintEngine,
  writeHints,
} from '../../../src/core/hint-engine'
import type { UsageState } from '../../../src/core/usage-tracker'

const fixedNow = new Date('2026-02-05T00:00:00Z')

const buildCommands = (counts: Record<string, number>) =>
  Object.fromEntries(
    Object.entries(counts).map(([name, count]) => [
      name,
      {
        count,
        firstRun: fixedNow.toISOString(),
        lastRun: fixedNow.toISOString(),
      },
    ])
  )

const createState = (overrides: Partial<UsageState> = {}): UsageState => ({
  firstRun: fixedNow.toISOString(),
  totalRuns: overrides.totalRuns ?? 0,
  commands: overrides.commands ?? {},
  milestones: overrides.milestones ?? {},
})

describe('HintEngine', () => {
  it('ships with contextual post-run rules', () => {
    const contextual = DEFAULT_HINT_RULES.filter(
      (rule) => rule.audience === 'contextual'
    )

    // All hints are now contextual and post-run only
    expect(contextual.length).toBeGreaterThanOrEqual(5)
    expect(DEFAULT_HINT_RULES.every((rule) => rule.postRun === true)).toBe(true)
  })

  it('returns no pre-run hints (all hints are post-run)', () => {
    const engine = new HintEngine()
    const state = createState({ totalRuns: 2 })

    const hints = engine.getHints(state, { command: 'front.inbox' })

    // No pre-run hints exist anymore
    expect(hints).toHaveLength(0)
  })

  it('suppresses hints in json or quiet mode', () => {
    const engine = new HintEngine()
    const state = createState({ totalRuns: 2 })

    expect(
      engine.getHints(state, { command: 'front.inbox', format: 'json' })
    ).toEqual([])

    expect(
      engine.getPostRunHint(state, { command: 'front.inbox', quiet: true })
    ).toBeNull()
  })

  it('retires hints after follow-up actions', () => {
    const engine = new HintEngine()
    const state = createState({
      totalRuns: 2,
      commands: buildCommands({ wizard: 1 }),
      milestones: {
        auth_configured: { achieved: true, achievedAt: fixedNow.toISOString() },
      },
    })

    const hints = engine.getHints(state, { command: 'front.inbox' })

    expect(
      hints.find((hint) => hint.id === 'onboarding.wizard')
    ).toBeUndefined()
    expect(hints.find((hint) => hint.id === 'onboarding.auth')).toBeUndefined()
  })

  it('returns contextual hints after specific commands', () => {
    const engine = new HintEngine()
    const state = createState({
      totalRuns: 4,
      commands: buildCommands({ 'front.inbox': 1 }),
    })

    const hint = engine.getPostRunHint(state, { command: 'front.inbox' })
    expect(hint?.id).toBe('context.front.triage')

    const retiredState = createState({
      totalRuns: 4,
      commands: buildCommands({ 'front.inbox': 1, 'front.triage': 1 }),
    })

    expect(
      engine.getPostRunHint(retiredState, { command: 'front.inbox' })
    ).toBeNull()
  })

  it('respects the max hint cap for post-run hints', () => {
    const engine = new HintEngine()
    const state = createState({
      totalRuns: 4,
      commands: buildCommands({ 'front.inbox': 1 }),
    })

    expect(
      engine.getPostRunHint(state, {
        command: 'front.inbox',
        previouslyShown: 2,
      })
    ).toBeNull()
  })

  it('writes hints to stderr', () => {
    const stderr = new PassThrough()
    const chunks: string[] = []
    stderr.on('data', (chunk) => chunks.push(chunk.toString()))

    const hints: Hint[] = [
      { id: 'test', message: 'Hello from a hint.', audience: 'onboarding' },
    ]

    writeHints(hints, stderr)

    expect(chunks.join('')).toBe('Hello from a hint.\n')
  })
})
