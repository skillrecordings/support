import { describe, expect, it } from 'vitest'
import {
  getAuthAdaptiveDescription,
  getFrontAdaptiveDescription,
  getInngestAdaptiveDescription,
  getRootAdaptiveDescription,
} from '../../../src/core/adaptive-help'
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

describe('adaptive help descriptions', () => {
  it('falls back to static descriptions when usage is unavailable', () => {
    const description = getFrontAdaptiveDescription(null)
    expect(description).toContain('Front conversations')
    expect(description).toContain('Environment')
  })

  it('collapses root help from full to abbreviated to minimal', () => {
    const full = getRootAdaptiveDescription(createState({ totalRuns: 0 }))
    const abbreviated = getRootAdaptiveDescription(
      createState({ totalRuns: 2 })
    )
    const minimal = getRootAdaptiveDescription(createState({ totalRuns: 5 }))

    expect(full).toContain('Getting Started')
    expect(abbreviated).toContain('Start here')
    expect(minimal).toContain('Use --help for details.')
    expect(full.length).toBeGreaterThan(abbreviated.length)
    expect(abbreviated.length).toBeGreaterThan(minimal.length)
  })

  it('collapses group help based on command usage counts', () => {
    const frontFull = getFrontAdaptiveDescription(
      createState({
        totalRuns: 8,
        commands: buildCommands({ 'auth.status': 8 }),
      })
    )
    const frontAbbrev = getFrontAdaptiveDescription(
      createState({
        commands: buildCommands({ 'front.inbox': 2 }),
      })
    )
    const frontMinimal = getFrontAdaptiveDescription(
      createState({
        commands: buildCommands({ 'front.inbox': 5 }),
      })
    )

    expect(frontFull).toContain('Start here')
    expect(frontAbbrev).toContain('Common')
    expect(frontMinimal).toContain('Front API commands')

    const authFull = getAuthAdaptiveDescription(
      createState({
        totalRuns: 10,
        commands: buildCommands({ 'front.inbox': 10 }),
      })
    )
    const authAbbrev = getAuthAdaptiveDescription(
      createState({
        commands: buildCommands({ 'auth.status': 2 }),
      })
    )
    const authMinimal = getAuthAdaptiveDescription(
      createState({
        commands: buildCommands({ 'auth.status': 5 }),
      })
    )

    expect(authFull).toContain('Check your setup')
    expect(authAbbrev).toContain('Commands')
    expect(authMinimal).toContain('Auth status commands')

    const inngestFull = getInngestAdaptiveDescription(
      createState({
        totalRuns: 12,
        commands: buildCommands({ 'front.inbox': 12 }),
      })
    )
    const inngestAbbrev = getInngestAdaptiveDescription(
      createState({
        commands: buildCommands({ 'inngest.events': 2 }),
      })
    )
    const inngestMinimal = getInngestAdaptiveDescription(
      createState({
        commands: buildCommands({ 'inngest.events': 5 }),
      })
    )

    expect(inngestFull).toContain('Debug pipeline runs')
    expect(inngestAbbrev).toContain('Common')
    expect(inngestMinimal).toContain('Inngest events and runs debugging')
  })
})
