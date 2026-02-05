import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  USER_CONFIG_PATHS,
  getAgeKeyPath,
  getUserConfigDir,
  getUserConfigPath,
  hasAgeKey,
  hasUserConfig,
} from './user-config'

/**
 * Helper to restore env var - handles undefined properly
 * (assigning undefined to process.env.X sets it to string "undefined")
 */
function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = value
  }
}

describe('getUserConfigDir', () => {
  let originalXdg: string | undefined

  beforeEach(() => {
    originalXdg = process.env.XDG_CONFIG_HOME
  })

  afterEach(() => {
    restoreEnv('XDG_CONFIG_HOME', originalXdg)
  })

  it('returns XDG_CONFIG_HOME/skill when XDG_CONFIG_HOME is set', () => {
    const xdgHome = '/custom/config'
    process.env.XDG_CONFIG_HOME = xdgHome

    const result = getUserConfigDir()
    expect(result).toBe(join(xdgHome, 'skill'))
  })

  it('returns ~/.config/skill when XDG_CONFIG_HOME is not set', () => {
    delete process.env.XDG_CONFIG_HOME

    const result = getUserConfigDir()
    expect(result).toContain('.config/skill')
  })

  it('ignores XDG_CONFIG_HOME when empty string', () => {
    process.env.XDG_CONFIG_HOME = ''

    const result = getUserConfigDir()
    expect(result).toContain('.config/skill')
  })

  it('ignores XDG_CONFIG_HOME when only whitespace', () => {
    process.env.XDG_CONFIG_HOME = '   '

    const result = getUserConfigDir()
    expect(result).toContain('.config/skill')
  })

  it('returns provided configDir override', () => {
    const override = '/test/override'
    const result = getUserConfigDir(override)
    expect(result).toBe(override)
  })
})

describe('getUserConfigPath', () => {
  let originalXdg: string | undefined

  beforeEach(() => {
    originalXdg = process.env.XDG_CONFIG_HOME
  })

  afterEach(() => {
    restoreEnv('XDG_CONFIG_HOME', originalXdg)
  })

  it('returns absolute path for age key', () => {
    const configDir = '/test/config'
    const result = getUserConfigPath(USER_CONFIG_PATHS.ageKey, configDir)
    expect(result).toBe(join(configDir, 'age.key'))
  })

  it('returns absolute path for encrypted env', () => {
    const configDir = '/test/config'
    const result = getUserConfigPath(USER_CONFIG_PATHS.envEncrypted, configDir)
    expect(result).toBe(join(configDir, '.env.user.encrypted'))
  })

  it('returns absolute path for config json', () => {
    const configDir = '/test/config'
    const result = getUserConfigPath(USER_CONFIG_PATHS.configJson, configDir)
    expect(result).toBe(join(configDir, 'config.json'))
  })

  it('uses getUserConfigDir when configDir not provided', () => {
    delete process.env.XDG_CONFIG_HOME
    const result = getUserConfigPath(USER_CONFIG_PATHS.ageKey)
    expect(result).toContain('.config/skill')
    expect(result).toContain('age.key')
  })
})

describe('hasUserConfig', () => {
  let testDir: string

  beforeEach(() => {
    testDir = join(tmpdir(), `skill-test-${Date.now()}`)
    mkdirSync(testDir, { recursive: true })
  })

  it('returns true when .env.user.encrypted exists', async () => {
    const envPath = join(testDir, USER_CONFIG_PATHS.envEncrypted)
    writeFileSync(envPath, 'encrypted content')

    const result = await hasUserConfig(testDir)
    expect(result).toBe(true)

    rmSync(testDir, { recursive: true })
  })

  it('returns false when .env.user.encrypted does not exist', async () => {
    const result = await hasUserConfig(testDir)
    expect(result).toBe(false)

    rmSync(testDir, { recursive: true })
  })
})

describe('hasAgeKey', () => {
  let testDir: string

  beforeEach(() => {
    testDir = join(tmpdir(), `skill-test-${Date.now()}`)
    mkdirSync(testDir, { recursive: true })
  })

  it('returns true when age.key exists', async () => {
    const keyPath = join(testDir, USER_CONFIG_PATHS.ageKey)
    writeFileSync(keyPath, 'AGE-SECRET-KEY-XXX')

    const result = await hasAgeKey(testDir)
    expect(result).toBe(true)

    rmSync(testDir, { recursive: true })
  })

  it('returns false when age.key does not exist', async () => {
    const result = await hasAgeKey(testDir)
    expect(result).toBe(false)

    rmSync(testDir, { recursive: true })
  })
})

describe('getAgeKeyPath', () => {
  let originalAgeUserKey: string | undefined
  let originalXdgConfigHome: string | undefined

  beforeEach(() => {
    originalAgeUserKey = process.env.AGE_USER_KEY
    originalXdgConfigHome = process.env.XDG_CONFIG_HOME
  })

  afterEach(() => {
    restoreEnv('AGE_USER_KEY', originalAgeUserKey)
    restoreEnv('XDG_CONFIG_HOME', originalXdgConfigHome)
  })

  it('returns AGE_USER_KEY env var when set', () => {
    const envPath = '/custom/path/to/key'
    process.env.AGE_USER_KEY = envPath

    const result = getAgeKeyPath()
    expect(result).toBe(envPath)
  })

  it('returns default path when AGE_USER_KEY not set', () => {
    delete process.env.AGE_USER_KEY
    delete process.env.XDG_CONFIG_HOME

    const result = getAgeKeyPath()
    expect(result).toContain('.config/skill')
    expect(result).toContain('age.key')
  })

  it('returns default path when AGE_USER_KEY is empty', () => {
    process.env.AGE_USER_KEY = ''
    delete process.env.XDG_CONFIG_HOME

    const result = getAgeKeyPath()
    expect(result).toContain('.config/skill')
    expect(result).toContain('age.key')
  })

  it('returns default path when AGE_USER_KEY is whitespace', () => {
    process.env.AGE_USER_KEY = '   '
    delete process.env.XDG_CONFIG_HOME

    const result = getAgeKeyPath()
    expect(result).toContain('.config/skill')
    expect(result).toContain('age.key')
  })

  it('uses provided configDir override', () => {
    delete process.env.AGE_USER_KEY

    const configDir = '/test/config'
    const result = getAgeKeyPath(configDir)
    expect(result).toBe(join(configDir, 'age.key'))
  })
})

describe('USER_CONFIG_PATHS', () => {
  it('has correct file names', () => {
    expect(USER_CONFIG_PATHS.ageKey).toBe('age.key')
    expect(USER_CONFIG_PATHS.envEncrypted).toBe('.env.user.encrypted')
    expect(USER_CONFIG_PATHS.configJson).toBe('config.json')
  })
})
