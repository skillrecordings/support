import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UsageTracker } from '../../../src/core/usage-tracker'

const fixedNow = new Date('2026-02-05T00:00:00Z')

async function createTempDir() {
  return mkdtemp(join(tmpdir(), 'skill-cli-usage-'))
}

describe('UsageTracker', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(fixedNow)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('records command runs and increments counts', async () => {
    const configDir = await createTempDir()
    const tracker = new UsageTracker({ configDir, now: () => fixedNow })

    await tracker.record('front.inbox')
    await tracker.record('front.inbox')

    expect(await tracker.getCommandCount('front.inbox')).toBe(2)
    expect(await tracker.totalRuns()).toBe(2)

    await rm(configDir, { recursive: true, force: true })
  })

  it('sets and reads milestones', async () => {
    const configDir = await createTempDir()
    const tracker = new UsageTracker({ configDir, now: () => fixedNow })

    expect(await tracker.hasMilestone('auth_configured')).toBe(false)
    await tracker.setMilestone('auth_configured')
    expect(await tracker.hasMilestone('auth_configured')).toBe(true)

    await rm(configDir, { recursive: true, force: true })
  })

  it('calculates total runs', async () => {
    const configDir = await createTempDir()
    const tracker = new UsageTracker({ configDir, now: () => fixedNow })

    await tracker.record('front.inbox')
    await tracker.record('front.triage')
    await tracker.record('front.triage')

    expect(await tracker.totalRuns()).toBe(3)

    await rm(configDir, { recursive: true, force: true })
  })

  it('calculates days since first run', async () => {
    const configDir = await createTempDir()
    const tracker = new UsageTracker({ configDir, now: () => fixedNow })

    await tracker.record('front.inbox')

    const later = new Date('2026-02-10T00:00:00Z')
    const laterTracker = new UsageTracker({ configDir, now: () => later })

    expect(await laterTracker.daysSinceFirstRun()).toBe(5)

    await rm(configDir, { recursive: true, force: true })
  })

  it('recovers from corrupt file content', async () => {
    const configDir = await createTempDir()
    const usageFile = join(configDir, 'usage.json')

    await writeFile(usageFile, '{ not: valid json', 'utf-8')

    const tracker = new UsageTracker({ configDir, now: () => fixedNow })
    await tracker.record('front.inbox')

    expect(await tracker.totalRuns()).toBe(1)
    expect(await tracker.getCommandCount('front.inbox')).toBe(1)

    await rm(configDir, { recursive: true, force: true })
  })

  it('uses XDG_CONFIG_HOME when set', async () => {
    const xdgConfigHome = await createTempDir()
    const originalEnv = process.env.XDG_CONFIG_HOME
    process.env.XDG_CONFIG_HOME = xdgConfigHome

    const tracker = new UsageTracker({ now: () => fixedNow })
    await tracker.record('front.inbox')

    const usageFile = join(xdgConfigHome, 'skill-cli', 'usage.json')
    expect(await tracker.getCommandCount('front.inbox')).toBe(1)

    await rm(xdgConfigHome, { recursive: true, force: true })
    if (originalEnv === undefined) {
      delete process.env.XDG_CONFIG_HOME
    } else {
      process.env.XDG_CONFIG_HOME = originalEnv
    }
  })
})
