export const EXIT_CODES = {
  success: 0,
  error: 1,
  usage: 2,
  auth: 10,
  network: 11,
  database: 12,
} as const

export interface CLIErrorOptions {
  userMessage: string
  exitCode?: number
  suggestion?: string
  debugMessage?: string
  cause?: unknown
}

export class CLIError extends Error {
  userMessage: string
  exitCode: number
  suggestion?: string
  debugMessage?: string

  constructor({
    userMessage,
    exitCode = EXIT_CODES.error,
    suggestion,
    debugMessage,
    cause,
  }: CLIErrorOptions) {
    super(debugMessage ?? userMessage)

    if (cause !== undefined) {
      this.cause = cause
    }

    this.name = 'CLIError'
    this.userMessage = userMessage
    this.exitCode = exitCode
    this.suggestion = suggestion
    this.debugMessage = debugMessage
  }
}

export class AuthError extends CLIError {
  constructor(options: Omit<CLIErrorOptions, 'exitCode'>) {
    super({ ...options, exitCode: EXIT_CODES.auth })
    this.name = 'AuthError'
  }
}

export class NetworkError extends CLIError {
  constructor(options: Omit<CLIErrorOptions, 'exitCode'>) {
    super({ ...options, exitCode: EXIT_CODES.network })
    this.name = 'NetworkError'
  }
}

export class DatabaseError extends CLIError {
  constructor(options: Omit<CLIErrorOptions, 'exitCode'>) {
    super({ ...options, exitCode: EXIT_CODES.database })
    this.name = 'DatabaseError'
  }
}

export function formatError(error: unknown): string {
  if (error instanceof CLIError) {
    if (error.suggestion) {
      return `${error.userMessage}\nSuggestion: ${error.suggestion}`
    }

    return error.userMessage
  }

  if (error instanceof Error) {
    return error.message || 'An unexpected error occurred.'
  }

  return 'An unexpected error occurred.'
}
