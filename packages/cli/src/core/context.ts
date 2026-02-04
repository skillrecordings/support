import { type SecretsProvider, createSecretsProvider } from './secrets'
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

export async function createContext(
  overrides: Partial<CommandContext> = {}
): Promise<CommandContext> {
  const signal = overrides.signal ?? new AbortController().signal
  const secrets = overrides.secrets ?? (await createSecretsProvider())

  return {
    stdin: overrides.stdin ?? process.stdin,
    stdout: overrides.stdout ?? process.stdout,
    stderr: overrides.stderr ?? process.stderr,
    config: overrides.config ?? {},
    signal,
    secrets,
    format: overrides.format ?? 'text',
    onCleanup: overrides.onCleanup ?? (() => {}),
  }
}
