import { LinearClient } from '@linear/sdk'
import { CLIError } from '../../core/errors'

/**
 * Get Linear API client with validation
 */
export function getLinearClient(): LinearClient {
  const apiKey = process.env.LINEAR_API_KEY

  if (!apiKey) {
    throw new CLIError({
      userMessage: 'LINEAR_API_KEY environment variable is not set.',
      suggestion:
        'Set LINEAR_API_KEY to your Linear API token. Get it from https://linear.app/settings/api',
      exitCode: 1,
    })
  }

  return new LinearClient({ apiKey })
}
