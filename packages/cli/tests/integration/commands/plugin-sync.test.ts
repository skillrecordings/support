import { readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { executePluginSync } from '../../../src/commands/plugin-sync'
import * as fsExtra from '../../../src/core/fs-extra'
import { createTestContext } from '../../helpers/test-context'

vi.mock('../../../src/core/fs-extra', () => ({
  copy: vi.fn(),
  ensureDir: vi.fn(),
  pathExists: vi.fn(),
  readJson: vi.fn(),
}))

const normalize = (value: string): string => value.replace(/\\/g, '/')

const getSourceManifestPath = (): string =>
  normalize(join(process.cwd(), 'plugin/.claude-plugin/plugin.json'))

const getTargetManifestPath = (global?: boolean): string => {
  const base = join(homedir(), '.claude', global ? 'skills' : 'plugins')
  return normalize(join(base, 'skill-cli/.claude-plugin/plugin.json'))
}

describe('plugin sync', () => {
  const copy = vi.mocked(fsExtra.copy)
  const ensureDir = vi.mocked(fsExtra.ensureDir)
  const pathExists = vi.mocked(fsExtra.pathExists)
  const readJson = vi.mocked(fsExtra.readJson)

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('plugin.json has required fields', () => {
    const manifestPath = join(
      process.cwd(),
      'plugin/.claude-plugin/plugin.json'
    )
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))

    expect(manifest.name).toBe('skill-cli')
    expect(manifest.version).toBe('1.0.0')
    expect(manifest.displayName).toBe('Skill Recordings CLI')
    expect(manifest.skills).toEqual(['front-inbox'])
    expect(manifest.cliVersion).toBe('${PACKAGE_JSON_VERSION}')
  })

  it('skips sync when installed version matches', async () => {
    const sourcePath = getSourceManifestPath()
    const targetPath = getTargetManifestPath()

    pathExists.mockImplementation(async (path: string) => {
      const normalized = normalize(path)
      if (normalized === sourcePath) return true
      if (normalized === targetPath) return true
      return false
    })

    readJson.mockImplementation(async (path: string) => {
      const normalized = normalize(path)
      if (normalized === sourcePath) return { version: '1.0.0' }
      if (normalized === targetPath) return { version: '1.0.0' }
      return { version: '0.0.0' }
    })

    const { ctx, getStdout } = await createTestContext({ format: 'text' })

    await executePluginSync(ctx, {})

    expect(getStdout()).toContain('up-to-date')
    expect(copy).not.toHaveBeenCalled()
    expect(ensureDir).not.toHaveBeenCalled()
  })

  it('syncs when versions differ', async () => {
    const sourcePath = getSourceManifestPath()
    const targetPath = getTargetManifestPath()

    pathExists.mockImplementation(async (path: string) => {
      const normalized = normalize(path)
      if (normalized === sourcePath) return true
      if (normalized === targetPath) return true
      return false
    })

    readJson.mockImplementation(async (path: string) => {
      const normalized = normalize(path)
      if (normalized === sourcePath) return { version: '1.0.0' }
      if (normalized === targetPath) return { version: '0.9.0' }
      return { version: '0.0.0' }
    })

    const { ctx, getStdout } = await createTestContext({ format: 'text' })

    await executePluginSync(ctx, {})

    expect(getStdout()).toContain('synced')
    expect(ensureDir).toHaveBeenCalled()
    expect(copy).toHaveBeenCalled()
  })

  it('dry-run does not write files', async () => {
    const sourcePath = getSourceManifestPath()
    const targetPath = getTargetManifestPath()

    pathExists.mockImplementation(async (path: string) => {
      const normalized = normalize(path)
      if (normalized === sourcePath) return true
      if (normalized === targetPath) return false
      return false
    })

    readJson.mockImplementation(async (path: string) => {
      const normalized = normalize(path)
      if (normalized === sourcePath) return { version: '1.0.0' }
      return { version: '0.0.0' }
    })

    const { ctx, getStdout } = await createTestContext({ format: 'text' })

    await executePluginSync(ctx, { dry: true })

    expect(getStdout()).toContain('dry-run')
    expect(copy).not.toHaveBeenCalled()
    expect(ensureDir).not.toHaveBeenCalled()
  })

  it('force syncs even when versions match', async () => {
    const sourcePath = getSourceManifestPath()
    const targetPath = getTargetManifestPath()

    pathExists.mockImplementation(async (path: string) => {
      const normalized = normalize(path)
      if (normalized === sourcePath) return true
      if (normalized === targetPath) return true
      return false
    })

    readJson.mockImplementation(async (path: string) => {
      const normalized = normalize(path)
      if (normalized === sourcePath) return { version: '1.0.0' }
      if (normalized === targetPath) return { version: '1.0.0' }
      return { version: '0.0.0' }
    })

    const { ctx, getStdout } = await createTestContext({ format: 'text' })

    await executePluginSync(ctx, { force: true })

    expect(getStdout()).toContain('synced')
    expect(copy).toHaveBeenCalled()
    expect(ensureDir).toHaveBeenCalled()
  })
})
