import { spawnSync } from 'node:child_process'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const cliRoot = resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '..',
  '..'
)
const installScript = join(cliRoot, 'install.sh')

const tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(
    tempRoots.map((dir) => rm(dir, { recursive: true, force: true }))
  )
  tempRoots.length = 0
})

describe('install script', () => {
  it('installs a downloaded binary to ~/.local/bin', async () => {
    const root = await mkdtemp(join(tmpdir(), 'skill-install-test-'))
    tempRoots.push(root)

    const assetPath = join(root, 'skill-bun-linux-x64')
    const installDir = join(root, 'bin')
    const expectedVersion = 'skill v0.0.0 (test) bun-linux-x64'

    const stubBinary = `#!/usr/bin/env bash\nif [ "$1" = "--version" ]; then\n  echo "${expectedVersion}"\n  exit 0\nfi\necho "skill stub"\n`

    await writeFile(assetPath, stubBinary)
    await chmod(assetPath, 0o755)

    const result = spawnSync('bash', [installScript], {
      encoding: 'utf8',
      env: {
        ...process.env,
        SKILL_CLI_OS: 'Linux',
        SKILL_CLI_ARCH: 'x86_64',
        SKILL_CLI_ASSET_URL: `file://${assetPath}`,
        SKILL_CLI_INSTALL_DIR: installDir,
        SKILL_CLI_VERSION: 'cli-v0.0.0',
      },
    })

    expect(result.status).toBe(0)

    const installedPath = join(installDir, 'skill')
    const versionResult = spawnSync(installedPath, ['--version'], {
      encoding: 'utf8',
    })

    expect(versionResult.status).toBe(0)
    expect(versionResult.stdout.trim()).toBe(expectedVersion)
  })
})
