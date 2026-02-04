import { DEFAULT_SECRETS_PROVIDER, type SecretsProvider } from './secrets'
import type { CleanupFn } from './signals'

export type OutputFormat = 'json' | 'text' | 'table'

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
    secrets: overrides.secrets ?? DEFAULT_SECRETS_PROVIDER,
    format: overrides.format ?? 'text',
    onCleanup: overrides.onCleanup ?? (() => {}),
  }
}
