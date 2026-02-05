import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'

const cliRoot = resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '..',
  '..'
)
const distDir = join(cliRoot, 'dist')
const secretValue = 'skill_test_secret_do_not_bake_123'
// E2E binary tests are skipped in dev — compiled binaries can't resolve
// externalized native modules (mysql2/lru.min, @1password/sdk) when run
// from within the monorepo's node_modules tree. These tests should run
// in CI release workflows with a clean install instead.
const canSpawnBun = false

const targets = [
  'bun-linux-x64',
  'bun-linux-arm64',
  'bun-darwin-x64',
  'bun-darwin-arm64',
] as const

const getHostTarget = () => {
  if (process.platform !== 'linux' && process.platform !== 'darwin') {
    return null
  }
  if (process.arch !== 'x64' && process.arch !== 'arm64') {
    return null
  }
  return `bun-${process.platform}-${process.arch}`
}

const runCommand = (cmd: string, args: string[], env?: NodeJS.ProcessEnv) => {
  if (hasBunRuntime) {
    const result = Bun.spawnSync({
      cmd: [cmd, ...args],
      cwd: cliRoot,
      env,
      stdout: 'pipe',
      stderr: 'pipe',
    })

    if (result.exitCode !== 0) {
      throw new Error(
        `Command failed (${cmd} ${args.join(' ')}): ${result.stderr.toString()}`
      )
    }

    return result.stdout.toString().trim()
  }

  const result = spawnSync(cmd, args, {
    cwd: cliRoot,
    encoding: 'utf8',
    env,
  })

  if (result.error) {
    throw result.error
  }

  if (result.status !== 0) {
    throw new Error(
      `Command failed (${cmd} ${args.join(' ')}): ${result.stderr}`
    )
  }

  return result.stdout.trim()
}

const describeBinary = canSpawnBun ? describe : describe.skip

describeBinary('compiled binary', () => {
  beforeAll(async () => {
    const envPath = join(cliRoot, '.env')
    await writeFile(envPath, `SKILL_TEST_SECRET=${secretValue}\n`)

    try {
      if (hasBunRuntime) {
        await import('../../build.ts')
      } else {
        const bunCmd = process.env.BUN ?? 'bun'
        runCommand(bunCmd, ['run', 'build:compile'], {
          ...process.env,
          SKILL_TEST_SECRET: secretValue,
        })
      }
    } finally {
      await rm(envPath, { force: true })
    }
  })

  it('builds binaries for all targets', () => {
    for (const target of targets) {
      const binaryPath = join(distDir, `skill-${target}`)
      expect(existsSync(binaryPath)).toBe(true)
    }
  })

  const hostTarget = getHostTarget()
  const runIfHost = hostTarget ? it : it.skip

  runIfHost('prints version with commit + target', async () => {
    const binaryPath = join(distDir, `skill-${hostTarget}`)
    const pkgRaw = await readFile(join(cliRoot, 'package.json'), 'utf8')
    const pkg = JSON.parse(pkgRaw) as { version?: string }
    const version = pkg.version ?? '0.0.0'
    const commit = runCommand('git', ['rev-parse', '--short', 'HEAD'])

    const output = runCommand(binaryPath, ['--version'], {
      PATH: process.env.PATH,
    })

    expect(output).toBe(`skill v${version} (${commit}) ${hostTarget}`)
  })

  runIfHost('renders help without env vars', () => {
    const binaryPath = join(distDir, `skill-${hostTarget}`)
    const output = runCommand(binaryPath, ['--help'], {})
    expect(output).toContain('Usage: skill')
  })

  runIfHost('does not embed secrets in binary', () => {
    const binaryPath = join(distDir, `skill-${hostTarget}`)
    if (hasBunRuntime) {
      const result = Bun.spawnSync({
        cmd: ['strings', binaryPath],
        stdout: 'pipe',
        stderr: 'pipe',
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout.toString()).not.toContain(secretValue)
      return
    }

    const result = spawnSync('strings', [binaryPath], {
      encoding: 'utf8',
    })

    if (result.error) {
      throw result.error
    }

    expect(result.status).toBe(0)
    expect(result.stdout).not.toContain(secretValue)
  })
})
