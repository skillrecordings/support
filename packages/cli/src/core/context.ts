import {
  type OutputFormat,
  type OutputFormatter,
  createOutputFormatter,
} from './output'
import { type SecretsProvider, createSecretsProvider } from './secrets'
import type { CleanupFn } from './signals'

export interface CommandContext {
  stdin: NodeJS.ReadStream
  stdout: NodeJS.WriteStream
  stderr: NodeJS.WriteStream
  config: Record<string, unknown>
  signal: AbortSignal
  secrets: SecretsProvider
  format: OutputFormat
  output: OutputFormatter
  verbose: boolean
  quiet: boolean
  onCleanup: (fn: CleanupFn) => void
}

export async function createContext(
  overrides: Partial<CommandContext> = {}
): Promise<CommandContext> {
  const signal = overrides.signal ?? new AbortController().signal
  const secrets = overrides.secrets ?? (await createSecretsProvider())
  const stdout = overrides.stdout ?? process.stdout
  const stderr = overrides.stderr ?? process.stderr
  const verbose = overrides.verbose ?? false
  const quiet = overrides.quiet ?? false
  const format = overrides.format ?? (stdout.isTTY ? 'text' : 'json')
  const output =
    overrides.output ??
    createOutputFormatter({
      format,
      stdout,
      stderr,
      verbose,
      quiet,
    })

  return {
    stdin: overrides.stdin ?? process.stdin,
    stdout,
    stderr,
    config: overrides.config ?? {},
    signal,
    secrets,
    format,
    output,
    verbose,
    quiet,
    onCleanup: overrides.onCleanup ?? (() => {}),
  }
}
