import { describe, expect, it } from 'vitest'
import {
  AuthError,
  CLIError,
  DatabaseError,
  EXIT_CODES,
  NetworkError,
  formatError,
} from '../../../src/core/errors'

describe('CLIError', () => {
  it('stores message metadata', () => {
    const error = new CLIError({
      userMessage: 'Something went wrong',
      exitCode: EXIT_CODES.usage,
      suggestion: 'Try again',
      debugMessage: 'Debug details',
    })

    expect(error.name).toBe('CLIError')
    expect(error.userMessage).toBe('Something went wrong')
    expect(error.exitCode).toBe(EXIT_CODES.usage)
    expect(error.suggestion).toBe('Try again')
    expect(error.debugMessage).toBe('Debug details')
    expect(error.message).toBe('Debug details')
  })
})

describe('CLIError subclasses', () => {
  const cases = [
    { label: 'AuthError', ErrorClass: AuthError, exitCode: EXIT_CODES.auth },
    {
      label: 'NetworkError',
      ErrorClass: NetworkError,
      exitCode: EXIT_CODES.network,
    },
    {
      label: 'DatabaseError',
      ErrorClass: DatabaseError,
      exitCode: EXIT_CODES.database,
    },
  ]

  for (const testCase of cases) {
    it(`sets ${testCase.label} exit code`, () => {
      const error = new testCase.ErrorClass({
        userMessage: 'Failure',
      })

      expect(error.exitCode).toBe(testCase.exitCode)
      expect(error.name).toBe(testCase.label)
    })
  }
})

describe('formatError', () => {
  it('renders user message and suggestion', () => {
    const error = new CLIError({
      userMessage: 'Missing credentials',
      exitCode: EXIT_CODES.auth,
      suggestion: 'Run `skill auth login`',
    })

    expect(formatError(error)).toBe(
      'Missing credentials\nSuggestion: Run `skill auth login`'
    )
  })

  it('handles unknown errors', () => {
    expect(formatError(new Error('Boom'))).toBe('Boom')
    expect(formatError('boom')).toBe('An unexpected error occurred.')
  })
})
