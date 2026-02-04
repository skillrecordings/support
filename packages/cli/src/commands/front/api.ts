/**
 * Front CLI raw API passthrough command
 *
 * Escape hatch for arbitrary Front API calls.
 */

import { createInstrumentedFrontClient } from '@skillrecordings/core/front/instrumented-client'
import type { Command } from 'commander'

/**
 * Get Front API client from environment
 */
function getFrontClient() {
  const apiToken = process.env.FRONT_API_TOKEN
  if (!apiToken) {
    throw new Error('FRONT_API_TOKEN environment variable is required')
  }
  return createInstrumentedFrontClient({ apiToken })
}

/**
 * Execute a raw Front API request
 */
async function apiPassthrough(
  method: string,
  endpoint: string,
  options: { data?: string }
): Promise<void> {
  const front = getFrontClient()
  const httpMethod = method.toUpperCase()

  let body: any = undefined
  if (options.data) {
    try {
      body = JSON.parse(options.data)
    } catch {
      throw new Error('Invalid JSON in --data')
    }
  }

  const normalizedEndpoint = endpoint.startsWith('/')
    ? endpoint
    : `/${endpoint}`

  let result: any
  switch (httpMethod) {
    case 'GET':
      result = await front.raw.get(normalizedEndpoint)
      break
    case 'POST':
      result = await front.raw.post(normalizedEndpoint, body)
      break
    case 'PATCH':
      result = await front.raw.patch(normalizedEndpoint, body)
      break
    case 'PUT':
      result = await front.raw.put(normalizedEndpoint, body)
      break
    case 'DELETE':
      result = await front.raw.delete(normalizedEndpoint)
      break
    default:
      throw new Error(
        `Unsupported method: ${method}. Use GET, POST, PATCH, PUT, or DELETE.`
      )
  }

  // Always JSON output for raw API
  console.log(JSON.stringify(result, null, 2))
}

/**
 * Register api command with Commander
 */
export function registerApiCommand(frontCommand: Command): void {
  frontCommand
    .command('api')
    .description('Raw Front API request (escape hatch)')
    .argument('<method>', 'HTTP method (GET, POST, PATCH, PUT, DELETE)')
    .argument(
      '<endpoint>',
      'API endpoint path (e.g., /me, /conversations/cnv_xxx)'
    )
    .option('--data <json>', 'Request body as JSON string')
    .action(
      async (method: string, endpoint: string, options: { data?: string }) => {
        try {
          await apiPassthrough(method, endpoint, options)
        } catch (error) {
          console.error(
            JSON.stringify(
              {
                error: error instanceof Error ? error.message : 'Unknown error',
                method: method.toUpperCase(),
                endpoint,
              },
              null,
              2
            )
          )
          process.exit(1)
        }
      }
    )
}
