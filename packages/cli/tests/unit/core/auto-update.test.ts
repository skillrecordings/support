import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AUTO_UPDATE_STATE_FILE,
  autoUpdateAfterCommand,
  checkForUpdate,
  compareSemver,
  performUpdate,
} from '../../../src/core/auto-update'

async function createTempDir() {
  return mkdtemp(join(tmpdir(), 'skill-cli-update-'))
}

describe('auto-update', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('compares semver versions', () => {
    expect(compareSemver('1.2.3', '1.2.3')).toBe(0)
    expect(compareSemver('1.2.4', '1.2.3')).toBe(1)
    expect(compareSemver('2.0.0', '1.9.9')).toBe(1)
    expect(compareSemver('1.2.3', '1.3.0')).toBe(-1)
    expect(compareSemver('1.2.3', '1.2.3-alpha.1')).toBe(1)
  })

  it('checks npm registry with 1-hour throttle', async () => {
    const configDir = await createTempDir()
    const now = new Date('2026-02-05T00:00:00Z')
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ 'dist-tags': { latest: '0.12.0' } }),
    })

    const first = await checkForUpdate({
      currentVersion: '0.11.2',
      configDir,
      now: () => now,
      fetchFn,
    })

    const second = await checkForUpdate({
      currentVersion: '0.11.2',
      configDir,
      now: () => now,
      fetchFn,
    })

    expect(first.updateAvailable).toBe(true)
    expect(first.checked).toBe(true)
    expect(second.checked).toBe(false)
    expect(fetchFn).toHaveBeenCalledTimes(1)

    await rm(configDir, { recursive: true, force: true })
  })

  it('performs update via bun or npm global install', async () => {
    const configDir = await createTempDir()
    const now = new Date('2026-02-05T00:00:00Z')
    const spawnFn = vi.fn(() => {
      const emitter = new EventEmitter()
      queueMicrotask(() => emitter.emit('close', 0))
      return emitter as unknown as ReturnType<
        typeof import('node:child_process').spawn
      >
    })

    const bunResult = await performUpdate({
      configDir,
      now: () => now,
      spawnFn,
      userAgent: 'bun/1.2.0',
    })

    expect(bunResult).toBe(true)
    expect(spawnFn).toHaveBeenCalledWith(
      'bun',
      ['add', '-g', '@skillrecordings/cli'],
      expect.objectContaining({ stdio: 'ignore' })
    )

    const statePath = join(configDir, AUTO_UPDATE_STATE_FILE)
    const saved = JSON.parse(await readFile(statePath, 'utf-8')) as {
      lastUpdateAt?: string
    }
    expect(saved.lastUpdateAt).toBe(now.toISOString())

    await rm(configDir, { recursive: true, force: true })
  })

  it('auto-updates after command completion (max once per 24h)', async () => {
    const configDir = await createTempDir()
    const now = new Date('2026-02-05T00:00:00Z')
    const checkForUpdateFn = vi.fn().mockResolvedValue({
      updateAvailable: true,
      latestVersion: '0.12.0',
      checked: true,
    })
    const performUpdateFn = vi.fn().mockResolvedValue(true)

    await autoUpdateAfterCommand({
      commandName: 'front.inbox',
      currentVersion: '0.11.2',
      configDir,
      now: () => now,
      checkForUpdateFn,
      performUpdateFn,
    })

    await autoUpdateAfterCommand({
      commandName: 'front.inbox',
      currentVersion: '0.11.2',
      configDir,
      now: () => now,
      checkForUpdateFn,
      performUpdateFn,
    })

    expect(performUpdateFn).toHaveBeenCalledTimes(1)

    await rm(configDir, { recursive: true, force: true })
  })

  it('skips auto-update in json or mcp modes and respects opt-out', async () => {
    const configDir = await createTempDir()
    const checkForUpdateFn = vi.fn()
    const performUpdateFn = vi.fn()

    await autoUpdateAfterCommand({
      commandName: 'mcp',
      currentVersion: '0.11.2',
      configDir,
      checkForUpdateFn,
      performUpdateFn,
    })

    await autoUpdateAfterCommand({
      commandName: 'front.inbox',
      currentVersion: '0.11.2',
      configDir,
      format: 'json',
      checkForUpdateFn,
      performUpdateFn,
    })

    process.env.SKILL_NO_AUTO_UPDATE = '1'
    await autoUpdateAfterCommand({
      commandName: 'front.inbox',
      currentVersion: '0.11.2',
      configDir,
      checkForUpdateFn,
      performUpdateFn,
    })
    delete process.env.SKILL_NO_AUTO_UPDATE

    expect(checkForUpdateFn).not.toHaveBeenCalled()
    expect(performUpdateFn).not.toHaveBeenCalled()

    await rm(configDir, { recursive: true, force: true })
  })
})
