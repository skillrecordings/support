import { spawn } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { ensureDir, pathExists, readJson } from './fs-extra'

export interface UpdateCheckResult {
  updateAvailable: boolean
  latestVersion?: string
  checked: boolean
}

interface AutoUpdateState {
  lastCheckAt?: string
  lastUpdateAt?: string
  lastKnownVersion?: string
}

interface AutoUpdateStoreOptions {
  configDir?: string
  now?: () => Date
}

export interface CheckForUpdateOptions {
  currentVersion: string
  packageName?: string
  configDir?: string
  now?: () => Date
  fetchFn?: typeof fetch
}

export interface PerformUpdateOptions {
  packageName?: string
  configDir?: string
  now?: () => Date
  spawnFn?: typeof spawn
  userAgent?: string
}

export interface AutoUpdateAfterCommandOptions {
  commandName: string
  currentVersion: string
  format?: string
  isDevMode?: boolean
  packageName?: string
  configDir?: string
  now?: () => Date
  checkForUpdateFn?: typeof checkForUpdate
  performUpdateFn?: typeof performUpdate
}

const CONFIG_DIR_NAME = 'skill-cli'
export const AUTO_UPDATE_STATE_FILE = 'auto-update.json'
const DEFAULT_PACKAGE = '@skillrecordings/cli'
const REGISTRY_BASE = 'https://registry.npmjs.org/'
const CHECK_THROTTLE_MS = 60 * 60 * 1000
const UPDATE_THROTTLE_MS = 24 * 60 * 60 * 1000

class AutoUpdateStore {
  private filePath: string
  private now: () => Date

  constructor(options: AutoUpdateStoreOptions = {}) {
    const configDir = resolveConfigDir(options.configDir)
    this.filePath = join(configDir, AUTO_UPDATE_STATE_FILE)
    this.now = options.now ?? (() => new Date())
  }

  getNow(): Date {
    return this.now()
  }

  async load(): Promise<AutoUpdateState> {
    try {
      if (await pathExists(this.filePath)) {
        const data = await readJson(this.filePath)
        if (isAutoUpdateState(data)) return data
      }
    } catch {
      // Ignore read/parse errors and fall back to defaults.
    }
    return {}
  }

  async save(state: AutoUpdateState): Promise<void> {
    try {
      await ensureDir(dirname(this.filePath))
      await writeFile(this.filePath, JSON.stringify(state, null, 2), 'utf-8')
    } catch {
      // Never let auto-update state break the CLI.
    }
  }
}

function resolveConfigDir(configDir?: string): string {
  if (configDir) return configDir
  const xdgConfigHome = process.env.XDG_CONFIG_HOME
  if (xdgConfigHome && xdgConfigHome.trim() !== '') {
    return join(xdgConfigHome, CONFIG_DIR_NAME)
  }
  return join(homedir(), '.config', CONFIG_DIR_NAME)
}

function isAutoUpdateState(value: unknown): value is AutoUpdateState {
  if (!value || typeof value !== 'object') return false
  const state = value as AutoUpdateState
  if (
    state.lastCheckAt !== undefined &&
    typeof state.lastCheckAt !== 'string'
  ) {
    return false
  }
  if (
    state.lastUpdateAt !== undefined &&
    typeof state.lastUpdateAt !== 'string'
  ) {
    return false
  }
  if (
    state.lastKnownVersion !== undefined &&
    typeof state.lastKnownVersion !== 'string'
  ) {
    return false
  }
  return true
}

function isAutoUpdateDisabled(): boolean {
  return process.env.SKILL_NO_AUTO_UPDATE === '1'
}

function isWithinWindow(
  timestamp: string | undefined,
  now: Date,
  windowMs: number
): boolean {
  if (!timestamp) return false
  const parsed = Date.parse(timestamp)
  if (Number.isNaN(parsed)) return false
  return now.getTime() - parsed < windowMs
}

function normalizePackageName(name: string): string {
  if (name.startsWith('@')) {
    return name.replace('/', '%2F')
  }
  return name
}

function parseSemver(version: string): {
  major: number
  minor: number
  patch: number
  prerelease?: string
} | null {
  const trimmed = version.trim().replace(/^v/, '')
  if (!trimmed) return null
  const [core, prerelease] = trimmed.split('-', 2)
  if (!core) return null
  const parts = core.split('.')
  if (parts.length < 3) return null
  const major = Number.parseInt(parts[0] ?? '', 10)
  const minor = Number.parseInt(parts[1] ?? '', 10)
  const patch = Number.parseInt(parts[2] ?? '', 10)
  if (Number.isNaN(major) || Number.isNaN(minor) || Number.isNaN(patch)) {
    return null
  }
  return { major, minor, patch, prerelease }
}

export function compareSemver(a: string, b: string): number {
  const parsedA = parseSemver(a)
  const parsedB = parseSemver(b)
  if (!parsedA || !parsedB) return 0
  if (parsedA.major !== parsedB.major) {
    return parsedA.major > parsedB.major ? 1 : -1
  }
  if (parsedA.minor !== parsedB.minor) {
    return parsedA.minor > parsedB.minor ? 1 : -1
  }
  if (parsedA.patch !== parsedB.patch) {
    return parsedA.patch > parsedB.patch ? 1 : -1
  }
  if (parsedA.prerelease && !parsedB.prerelease) return -1
  if (!parsedA.prerelease && parsedB.prerelease) return 1
  if (parsedA.prerelease && parsedB.prerelease) {
    if (parsedA.prerelease === parsedB.prerelease) return 0
    return parsedA.prerelease > parsedB.prerelease ? 1 : -1
  }
  return 0
}

function resolvePackageManager(userAgent?: string): 'bun' | 'npm' {
  const ua = userAgent ?? process.env.npm_config_user_agent ?? ''
  if (ua.startsWith('bun')) return 'bun'
  if (ua.includes('bun')) return 'bun'
  if (ua.startsWith('npm')) return 'npm'
  return 'npm'
}

export async function checkForUpdate(
  options: CheckForUpdateOptions
): Promise<UpdateCheckResult> {
  const packageName = options.packageName ?? DEFAULT_PACKAGE
  const fetchFn = options.fetchFn ?? fetch
  const store = new AutoUpdateStore({
    configDir: options.configDir,
    now: options.now,
  })
  const now = store.getNow()
  const state = await store.load()

  if (isWithinWindow(state.lastCheckAt, now, CHECK_THROTTLE_MS)) {
    const latest = state.lastKnownVersion
    const updateAvailable = latest
      ? compareSemver(latest, options.currentVersion) > 0
      : false
    return { updateAvailable, latestVersion: latest, checked: false }
  }

  let latestVersion: string | undefined
  try {
    const registryUrl = `${REGISTRY_BASE}${normalizePackageName(packageName)}`
    const response = await fetchFn(registryUrl, {
      headers: { Accept: 'application/json' },
    })
    if (response.ok) {
      const data = (await response.json()) as {
        'dist-tags'?: { latest?: string }
      }
      latestVersion = data['dist-tags']?.latest
    }
  } catch {
    // Ignore registry fetch failures.
  }

  state.lastCheckAt = now.toISOString()
  if (latestVersion) {
    state.lastKnownVersion = latestVersion
  }
  await store.save(state)

  const updateAvailable =
    latestVersion !== undefined &&
    compareSemver(latestVersion, options.currentVersion) > 0

  return { updateAvailable, latestVersion, checked: true }
}

export async function performUpdate(
  options: PerformUpdateOptions = {}
): Promise<boolean> {
  const packageName = options.packageName ?? DEFAULT_PACKAGE
  const store = new AutoUpdateStore({
    configDir: options.configDir,
    now: options.now,
  })
  const now = store.getNow()
  const packageManager = resolvePackageManager(options.userAgent)
  const spawnFn = options.spawnFn ?? spawn

  const [command, args] =
    packageManager === 'bun'
      ? ['bun', ['add', '-g', packageName]]
      : ['npm', ['install', '-g', packageName]]

  const exitCode = await new Promise<number>((resolve) => {
    try {
      const child = spawnFn(command, args, {
        stdio: 'ignore',
        env: process.env,
      })
      child.on('error', () => resolve(1))
      child.on('close', (code) => resolve(code ?? 1))
    } catch {
      resolve(1)
    }
  })

  if (exitCode === 0) {
    const state = await store.load()
    state.lastUpdateAt = now.toISOString()
    await store.save(state)
    return true
  }

  return false
}

export async function autoUpdateAfterCommand(
  options: AutoUpdateAfterCommandOptions
): Promise<void> {
  if (isAutoUpdateDisabled()) return
  if (options.isDevMode) return
  if (options.commandName === 'mcp') return
  if (options.format === 'json') return

  const store = new AutoUpdateStore({
    configDir: options.configDir,
    now: options.now,
  })
  const now = store.getNow()
  const state = await store.load()

  if (isWithinWindow(state.lastUpdateAt, now, UPDATE_THROTTLE_MS)) return

  const check = await (options.checkForUpdateFn ?? checkForUpdate)({
    currentVersion: options.currentVersion,
    packageName: options.packageName,
    configDir: options.configDir,
    now: options.now,
  })

  if (!check.updateAvailable) return

  state.lastUpdateAt = now.toISOString()
  await store.save(state)

  const updated = await (options.performUpdateFn ?? performUpdate)({
    packageName: options.packageName,
    configDir: options.configDir,
    now: options.now,
  })

  if (updated) return
}
