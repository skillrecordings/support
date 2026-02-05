import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const cliPath = resolve(process.cwd(), 'src/index.ts')

const runCli = (args: string[], env: Record<string, string | undefined>) =>
  spawnSync('bun', [cliPath, ...args], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
  })

const createConfigDir = async () => mkdtemp(join(tmpdir(), 'skill-cli-hints-'))

describe('cli hints lifecycle', () => {
  it('shows onboarding hints on first run', async () => {
    const configDir = await createConfigDir()

    const result = runCli(['init', 'MyApp'], {
      XDG_CONFIG_HOME: configDir,
      SKILL_CLI_FORCE_HINTS: '1',
    })

    expect(result.status).toBe(0)
    expect(result.stderr).toContain('New here? Run `skill wizard`')
  })

  it('records usage and milestones after command runs', async () => {
    const configDir = await createConfigDir()

    const result = runCli(['init', 'MyApp'], {
      XDG_CONFIG_HOME: configDir,
      SKILL_CLI_FORCE_HINTS: '1',
    })

    expect(result.status).toBe(0)

    const usagePath = join(configDir, 'skill-cli', 'usage.json')
    const usage = JSON.parse(await readFile(usagePath, 'utf8')) as {
      totalRuns: number
      commands: Record<string, { count: number }>
      milestones: Record<string, { achieved: boolean }>
    }

    expect(usage.totalRuns).toBe(1)
    expect(usage.commands.init?.count).toBe(1)
    expect(usage.milestones.auth_configured?.achieved).toBe(true)
  })

  it('suppresses hints in json, quiet, and piped output', async () => {
    const configDir = await createConfigDir()

    const pipedResult = runCli(['init', 'MyApp'], {
      XDG_CONFIG_HOME: configDir,
    })

    expect(pipedResult.status).toBe(0)
    expect(pipedResult.stderr).not.toContain('skill wizard')

    const jsonResult = runCli(['init', 'MyApp', '--json'], {
      XDG_CONFIG_HOME: await createConfigDir(),
      SKILL_CLI_FORCE_HINTS: '1',
    })

    expect(jsonResult.status).toBe(0)
    expect(jsonResult.stderr).not.toContain('skill wizard')

    const quietResult = runCli(['--quiet', 'init', 'MyApp'], {
      XDG_CONFIG_HOME: await createConfigDir(),
      SKILL_CLI_FORCE_HINTS: '1',
    })

    expect(quietResult.status).toBe(0)
    expect(quietResult.stderr).not.toContain('skill wizard')
  })
})
