import { LinearClient } from '@linear/sdk'

export function getLinearClient(): LinearClient {
  const apiKey = process.env.LINEAR_API_KEY
  if (!apiKey) {
    console.error('LINEAR_API_KEY environment variable is required')
    process.exit(1)
  }
  return new LinearClient({ apiKey })
}
