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
    .addHelpText(
      'after',
      `
━━━ Raw Front API Passthrough ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Escape hatch for making arbitrary Front API calls. Use this when no
  typed CLI command exists for what you need.

ARGUMENTS
  <method>      HTTP method: GET, POST, PATCH, PUT, DELETE
  <endpoint>    API path (leading / is optional — both work)

OPTIONS
  --data <json>   Request body as a valid JSON string (for POST, PATCH, PUT)

COMMON ENDPOINTS
  Endpoint                          What it returns
  ─────────────────────────────── ──────────────────────────────────────
  /me                               Authenticated identity
  /inboxes                          All inboxes
  /conversations/cnv_xxx            Conversation details
  /conversations/cnv_xxx/messages   Messages in a conversation
  /tags                             All tags
  /teammates                        All teammates
  /contacts                         All contacts
  /accounts                         All accounts
  /channels                         All channels
  /rules                            All rules

ENDPOINT NORMALIZATION
  Leading slash is optional. These are equivalent:
    skill front api GET /me
    skill front api GET me

OUTPUT
  Always JSON. Pipe to jq for filtering.

EXAMPLES
  # Check authenticated identity
  skill front api GET /me

  # List all inboxes
  skill front api GET /inboxes

  # Get a specific conversation
  skill front api GET /conversations/cnv_abc123

  # Archive a conversation
  skill front api PATCH /conversations/cnv_abc123 --data '{"status":"archived"}'

  # Apply a tag to a conversation
  skill front api POST /conversations/cnv_abc123/tags --data '{"tag_ids":["tag_xxx"]}'

  # Create a new tag
  skill front api POST /tags --data '{"name":"my-new-tag","highlight":"blue"}'

  # Delete a tag
  skill front api DELETE /tags/tag_xxx

  # List teammates and extract emails
  skill front api GET /teammates | jq '._results[].email'

  # Get conversation + pipe to jq for specific fields
  skill front api GET /conversations/cnv_abc123 | jq '{subject, status, assignee: .assignee.email}'

WHEN TO USE THIS vs TYPED COMMANDS
  Prefer typed commands when available — they have better error handling,
  pagination, and output formatting:
    skill front search        (not: skill front api GET /conversations/search/...)
    skill front inbox         (not: skill front api GET /inboxes)
    skill front tags list     (not: skill front api GET /tags)
    skill front conversation  (not: skill front api GET /conversations/cnv_xxx)

  Use "skill front api" for endpoints without a dedicated command, or when
  you need the raw response shape.

  Full API docs: https://dev.frontapp.com/reference
`
    )
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
