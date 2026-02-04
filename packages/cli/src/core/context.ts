import type { CleanupFn } from './signals'

export type OutputFormat = 'json' | 'text' | 'table'

export interface SecretsProvider {
  name: string
  isAvailable(): Promise<boolean>
  resolve(ref: string): Promise<string>
  resolveAll(refs: string[]): Promise<Record<string, string>>
}

export interface CommandContext {
  stdin: NodeJS.ReadStream
  stdout: NodeJS.WriteStream
  stderr: NodeJS.WriteStream
  config: Record<string, unknown>
  signal: AbortSignal
  secrets: SecretsProvider
  format: OutputFormat
  onCleanup: (fn: CleanupFn) => void
}

const defaultSecretsProvider: SecretsProvider = {
  name: 'none',
  async isAvailable() {
    return false
  },
  async resolve(ref: string) {
    throw new Error(`No secrets provider available for ${ref}`)
  },
  async resolveAll() {
    throw new Error('No secrets provider available')
  },
}

export function createContext(
  overrides: Partial<CommandContext> = {}
): CommandContext {
  const signal = overrides.signal ?? new AbortController().signal

  return {
    stdin: overrides.stdin ?? process.stdin,
    stdout: overrides.stdout ?? process.stdout,
    stderr: overrides.stderr ?? process.stderr,
    config: overrides.config ?? {},
    signal,
    secrets: overrides.secrets ?? defaultSecretsProvider,
    format: overrides.format ?? 'text',
    onCleanup: overrides.onCleanup ?? (() => {}),
  }
}
