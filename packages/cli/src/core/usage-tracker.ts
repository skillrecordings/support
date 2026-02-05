import { writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { ensureDir, pathExists, readJson } from './fs-extra'

export interface UsageState {
  firstRun: string
  totalRuns: number
  commands: Record<string, { count: number; lastRun: string; firstRun: string }>
  milestones: Record<string, { achieved: boolean; achievedAt?: string }>
}

interface UsageTrackerOptions {
  configDir?: string
  now?: () => Date
}

const CONFIG_DIR_NAME = 'skill-cli'
const USAGE_FILE_NAME = 'usage.json'

function resolveConfigDir(configDir?: string): string {
  if (configDir) return configDir
  const xdgConfigHome = process.env.XDG_CONFIG_HOME
  if (xdgConfigHome && xdgConfigHome.trim() !== '') {
    return join(xdgConfigHome, CONFIG_DIR_NAME)
  }
  return join(homedir(), '.config', CONFIG_DIR_NAME)
}

function createDefaultState(now: Date): UsageState {
  return {
    firstRun: now.toISOString(),
    totalRuns: 0,
    commands: {},
    milestones: {},
  }
}

function isUsageState(value: unknown): value is UsageState {
  if (!value || typeof value !== 'object') return false
  const state = value as UsageState
  if (typeof state.firstRun !== 'string') return false
  if (typeof state.totalRuns !== 'number') return false
  if (!state.commands || typeof state.commands !== 'object') return false
  if (!state.milestones || typeof state.milestones !== 'object') return false

  for (const entry of Object.values(state.commands)) {
    if (!entry || typeof entry !== 'object') return false
    if (typeof entry.count !== 'number') return false
    if (typeof entry.firstRun !== 'string') return false
    if (typeof entry.lastRun !== 'string') return false
  }

  for (const entry of Object.values(state.milestones)) {
    if (!entry || typeof entry !== 'object') return false
    if (typeof entry.achieved !== 'boolean') return false
    if (
      entry.achievedAt !== undefined &&
      typeof entry.achievedAt !== 'string'
    ) {
      return false
    }
  }

  return true
}

export class UsageTracker {
  private filePath: string
  private now: () => Date
  private statePromise?: Promise<UsageState>

  constructor(options: UsageTrackerOptions = {}) {
    const configDir = resolveConfigDir(options.configDir)
    this.filePath = join(configDir, USAGE_FILE_NAME)
    this.now = options.now ?? (() => new Date())
  }

  private async loadState(): Promise<UsageState> {
    if (!this.statePromise) {
      this.statePromise = this.loadStateInternal()
    }
    return this.statePromise
  }

  private async loadStateInternal(): Promise<UsageState> {
    try {
      if (await pathExists(this.filePath)) {
        const data = await readJson(this.filePath)
        if (isUsageState(data)) {
          return data
        }
      }
    } catch {
      // Ignore read/parse errors and fall back to defaults.
    }

    return createDefaultState(this.now())
  }

  private async saveState(state: UsageState): Promise<void> {
    try {
      await ensureDir(dirname(this.filePath))
      await writeFile(this.filePath, JSON.stringify(state, null, 2), 'utf-8')
    } catch {
      // Never let usage tracking break the CLI.
    }
  }

  async record(
    command: string,
    _opts: { duration?: number; success?: boolean } = {}
  ): Promise<UsageState> {
    const state = await this.loadState()
    const nowIso = this.now().toISOString()

    state.totalRuns += 1

    const existing = state.commands[command]
    if (existing) {
      existing.count += 1
      existing.lastRun = nowIso
    } else {
      state.commands[command] = {
        count: 1,
        firstRun: nowIso,
        lastRun: nowIso,
      }
    }

    await this.saveState(state)
    return state
  }

  async getUsage(): Promise<UsageState> {
    return this.loadState()
  }

  async getCommandCount(command: string): Promise<number> {
    const state = await this.loadState()
    return state.commands[command]?.count ?? 0
  }

  async hasMilestone(name: string): Promise<boolean> {
    const state = await this.loadState()
    return state.milestones[name]?.achieved ?? false
  }

  async setMilestone(name: string): Promise<void> {
    const state = await this.loadState()
    const existing = state.milestones[name]
    if (!existing || !existing.achieved) {
      state.milestones[name] = {
        achieved: true,
        achievedAt: this.now().toISOString(),
      }
      await this.saveState(state)
    }
  }

  async totalRuns(): Promise<number> {
    const state = await this.loadState()
    return state.totalRuns
  }

  async daysSinceFirstRun(): Promise<number> {
    const state = await this.loadState()
    const firstRunMs = Date.parse(state.firstRun)
    if (Number.isNaN(firstRunMs)) return 0
    const diffMs = this.now().getTime() - firstRunMs
    if (diffMs <= 0) return 0
    return Math.floor(diffMs / (1000 * 60 * 60 * 24))
  }
}

let cachedUsageTracker: UsageTracker | undefined

export function getUsageTracker(): UsageTracker {
  if (!cachedUsageTracker) {
    cachedUsageTracker = new UsageTracker()
  }
  return cachedUsageTracker
}
