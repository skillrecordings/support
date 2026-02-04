import { createInstrumentedFrontClient } from '@skillrecordings/core/front/instrumented-client'
import { CLIError } from '../../core/errors'

export function requireFrontToken(): string {
  const apiToken = process.env.FRONT_API_TOKEN
  if (!apiToken) {
    throw new CLIError({
      userMessage: 'FRONT_API_TOKEN environment variable is required.',
      suggestion:
        'Set FRONT_API_TOKEN in your shell or .env.local, or run: skill auth setup',
    })
  }
  return apiToken
}

export function getFrontClient() {
  return createInstrumentedFrontClient({ apiToken: requireFrontToken() })
}

export function normalizeId(idOrUrl: string): string {
  return idOrUrl.startsWith('http') ? idOrUrl.split('/').pop()! : idOrUrl
}
