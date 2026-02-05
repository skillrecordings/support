import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { UsageState } from '../../src/core/usage-tracker'

const cliPath = resolve(process.cwd(), 'src/index.ts')

const runCli = (args: string[], env: Record<string, string | undefined>) =>
  spawnSync('bun', [cliPath, ...args], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
  })

const createConfigDir = async () => mkdtemp(join(tmpdir(), 'skill-cli-hints-'))

const createUsageState = (overrides: Partial<UsageState> = {}): UsageState => {
  const nowIso = new Date().toISOString()
  return {
    firstRun: nowIso,
    totalRuns: 0,
    commands: {},
    milestones: {},
    ...overrides,
  }
}

const writeUsageState = async (configDir: string, state: UsageState) => {
  const usageDir = join(configDir, 'skill-cli')
  await mkdir(usageDir, { recursive: true })
  await writeFile(join(usageDir, 'usage.json'), JSON.stringify(state, null, 2))
}

const makeCommandEntry = (count = 1) => {
  const nowIso = new Date().toISOString()
  return { count, firstRun: nowIso, lastRun: nowIso }
}

describe('adaptive hints journey', () => {
  it('guides a fresh user and fades for a proficient one', async () => {
    const configDir = await createConfigDir()

    const firstRun = runCli(['init', 'MyApp'], {
      XDG_CONFIG_HOME: configDir,
      SKILL_CLI_FORCE_HINTS: '1',
    })

    expect(firstRun.status).toBe(0)
    expect(firstRun.stderr).toContain('New here? Run `skill wizard`')

    const secondRun = runCli(['init', 'MyApp'], {
      XDG_CONFIG_HOME: configDir,
      SKILL_CLI_FORCE_HINTS: '1',
    })

    expect(secondRun.status).toBe(0)
    expect(secondRun.stderr).toContain('skill wizard')
    expect(secondRun.stderr).toContain('skill front inbox')

    const proficientState = createUsageState({
      totalRuns: 6,
      commands: {
        wizard: makeCommandEntry(1),
        init: makeCommandEntry(2),
        health: makeCommandEntry(1),
        'front.inbox': makeCommandEntry(1),
        'front.triage': makeCommandEntry(1),
        'inngest.stats': makeCommandEntry(1),
        'axiom.query': makeCommandEntry(1),
      },
      milestones: {
        wizard_completed: {
          achieved: true,
          achievedAt: new Date().toISOString(),
        },
        auth_configured: {
          achieved: true,
          achievedAt: new Date().toISOString(),
        },
      },
    })

    await writeUsageState(configDir, proficientState)

    const proficientRun = runCli(['init', 'MyApp'], {
      XDG_CONFIG_HOME: configDir,
      SKILL_CLI_FORCE_HINTS: '1',
    })

    expect(proficientRun.status).toBe(0)
    expect(proficientRun.stderr.trim()).toBe('')
  })

  it('suppresses hints for json and quiet modes', async () => {
    const configDir = await createConfigDir()

    const jsonRun = runCli(['init', 'MyApp', '--json'], {
      XDG_CONFIG_HOME: configDir,
      SKILL_CLI_FORCE_HINTS: '1',
    })

    expect(jsonRun.status).toBe(0)
    expect(jsonRun.stderr).not.toContain('skill wizard')

    const quietRun = runCli(['--quiet', 'init', 'MyApp'], {
      XDG_CONFIG_HOME: await createConfigDir(),
      SKILL_CLI_FORCE_HINTS: '1',
    })

    expect(quietRun.status).toBe(0)
    expect(quietRun.stderr).not.toContain('skill wizard')
  })
})
