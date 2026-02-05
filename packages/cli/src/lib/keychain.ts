import { execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

type Platform = 'macos' | 'linux' | 'unsupported'

export function detectPlatform(): Platform {
  switch (process.platform) {
    case 'darwin':
      return 'macos'
    case 'linux':
      return 'linux'
    default:
      return 'unsupported'
  }
}

export function isKeychainAvailable(): boolean {
  const platform = detectPlatform()
  try {
    if (platform === 'macos') {
      execSync('which security', { stdio: 'pipe' })
      return true
    }
    if (platform === 'linux') {
      execSync('which secret-tool', { stdio: 'pipe' })
      return true
    }
    return false
  } catch {
    return false
  }
}

export function storeInKeychain(key: string, value: string): void {
  const platform = detectPlatform()

  if (platform === 'macos') {
    // -U flag updates if exists, -a account, -s service, -w password
    execSync(
      `security add-generic-password -a "$USER" -s ${JSON.stringify(key)} -w ${JSON.stringify(value)} -U`,
      { stdio: 'pipe' }
    )
    return
  }

  if (platform === 'linux') {
    execSync(
      `echo -n ${JSON.stringify(value)} | secret-tool store --label ${JSON.stringify(key)} service skill-cli key ${JSON.stringify(key)}`,
      { stdio: 'pipe' }
    )
    return
  }

  throw new Error(`Unsupported platform: ${process.platform}`)
}

export function readFromKeychain(key: string): string | null {
  const platform = detectPlatform()
  try {
    if (platform === 'macos') {
      return execSync(
        `security find-generic-password -a "$USER" -s ${JSON.stringify(key)} -w`,
        { stdio: 'pipe' }
      )
        .toString()
        .trim()
    }

    if (platform === 'linux') {
      return execSync(
        `secret-tool lookup service skill-cli key ${JSON.stringify(key)}`,
        { stdio: 'pipe' }
      )
        .toString()
        .trim()
    }

    return null
  } catch {
    return null
  }
}

export function deleteFromKeychain(key: string): void {
  const platform = detectPlatform()

  if (platform === 'macos') {
    try {
      execSync(
        `security delete-generic-password -a "$USER" -s ${JSON.stringify(key)}`,
        { stdio: 'pipe' }
      )
    } catch {
      // Not found — that's fine
    }
    return
  }

  if (platform === 'linux') {
    try {
      execSync(
        `secret-tool clear service skill-cli key ${JSON.stringify(key)}`,
        { stdio: 'pipe' }
      )
    } catch {
      // Not found — that's fine
    }
    return
  }
}

export function getShellProfileExportLine(key: string): string {
  const platform = detectPlatform()

  if (platform === 'macos') {
    return `export ${key}=$(security find-generic-password -a "$USER" -s "${key}" -w 2>/dev/null)`
  }

  if (platform === 'linux') {
    return `export ${key}=$(secret-tool lookup service skill-cli key "${key}" 2>/dev/null)`
  }

  throw new Error(`Unsupported platform: ${process.platform}`)
}

export function detectShellProfile(): string | null {
  const shell = process.env.SHELL || ''
  const home = homedir()

  if (shell.includes('zsh')) {
    return join(home, '.zshrc')
  }
  if (shell.includes('bash')) {
    // Prefer .bashrc, fall back to .bash_profile
    const bashrc = join(home, '.bashrc')
    const bashProfile = join(home, '.bash_profile')
    if (existsSync(bashrc)) return bashrc
    if (existsSync(bashProfile)) return bashProfile
    return bashrc // default to .bashrc even if it doesn't exist yet
  }

  return null
}

export function shellProfileHasExport(
  profilePath: string,
  key: string
): boolean {
  try {
    const content = readFileSync(profilePath, 'utf-8')
    // Check for any existing export of this key from keychain
    return content.includes(`export ${key}=`)
  } catch {
    return false
  }
}
