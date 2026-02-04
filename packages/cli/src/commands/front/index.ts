/**
 * Front CLI commands for debugging and investigation
 *
 * Provides direct access to Front API for:
 * - Fetching messages (body, author, recipients)
 * - Fetching conversations with message history
 * - Listing and looking up teammates
 * - Comparing webhook data vs API data
 */

import { createInstrumentedFrontClient } from '@skillrecordings/core/front/instrumented-client'
import type {
  Message as FrontMessage,
  MessageList,
} from '@skillrecordings/front-sdk'
import type { Command } from 'commander'
import { registerApiCommand } from './api'
import { registerArchiveCommand } from './archive'
import { registerAssignCommand } from './assign'
import { registerBulkArchiveCommand } from './bulk-archive'
import { registerConversationTagCommands } from './conversation-tag'
import {
  conversationActions,
  conversationLinks,
  hateoasWrap,
  messageLinks,
  teammateLinks,
  teammateListLinks,
} from './hateoas'
import { registerInboxCommand } from './inbox'
import { writeJsonOutput } from './json-output'
import { registerPullCommand } from './pull-conversations'
import { registerReplyCommand } from './reply'
import { registerReportCommand } from './report'
import { registerSearchCommand } from './search'
import { registerTagCommands } from './tags'
import { registerTriageCommand } from './triage'

type Message = FrontMessage

/**
 * Get Front API client from environment (instrumented)
 */
function getFrontClient() {
  const apiToken = process.env.FRONT_API_TOKEN
  if (!apiToken) {
    throw new Error('FRONT_API_TOKEN environment variable is required')
  }
  return createInstrumentedFrontClient({ apiToken })
}

/**
 * Get Front SDK client from environment (full typed client)
 */
function getFrontSdkClient() {
  const apiToken = process.env.FRONT_API_TOKEN
  if (!apiToken) {
    throw new Error('FRONT_API_TOKEN environment variable is required')
  }
  return createInstrumentedFrontClient({ apiToken })
}

/**
 * Format timestamp to human-readable
 */
function formatTimestamp(ts: number): string {
  return new Date(ts * 1000).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Truncate string with ellipsis
 */
function truncate(str: string, len: number): string {
  if (str.length <= len) return str
  return str.slice(0, len - 3) + '...'
}

/**
 * Normalize Front resource ID or URL to ID
 */
function normalizeId(idOrUrl: string): string {
  return idOrUrl.startsWith('http') ? idOrUrl.split('/').pop()! : idOrUrl
}

/**
 * Command: skill front message <id>
 * Fetch full message details from Front API
 */
async function getMessage(
  id: string,
  options: { json?: boolean }
): Promise<void> {
  try {
    const front = getFrontClient()
    const message = await front.messages.get(normalizeId(id))

    if (options.json) {
      writeJsonOutput(
        hateoasWrap({
          type: 'message',
          command: `skill front message ${normalizeId(id)} --json`,
          data: message,
          links: messageLinks(message.id),
        })
      )
      return
    }

    console.log('\n📧 Message Details:')
    console.log(`   ID:       ${message.id}`)
    console.log(`   Type:     ${message.type}`)
    console.log(`   Subject:  ${message.subject || '(none)'}`)
    console.log(`   Created:  ${formatTimestamp(message.created_at)}`)

    if (message.author) {
      console.log(`   Author:   ${message.author.email || message.author.id}`)
    }

    console.log('\n📬 Recipients:')
    for (const r of message.recipients) {
      console.log(`   ${r.role}: ${r.handle}`)
    }

    console.log('\n📝 Body:')
    // Strip HTML and show preview
    const textBody =
      message.text ||
      message.body
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    console.log(
      `   Length: ${message.body.length} chars (HTML), ${textBody.length} chars (text)`
    )
    console.log(`   Preview: ${truncate(textBody, 500)}`)

    if (message.attachments && message.attachments.length > 0) {
      console.log(`\n📎 Attachments: ${message.attachments.length}`)
      for (const a of message.attachments) {
        console.log(`   - ${a.filename} (${a.content_type})`)
      }
    }

    console.log('')
  } catch (error) {
    if (options.json) {
      console.error(
        JSON.stringify({
          error: error instanceof Error ? error.message : 'Unknown error',
        })
      )
    } else {
      console.error(
        'Error:',
        error instanceof Error ? error.message : 'Unknown error'
      )
    }
    process.exit(1)
  }
}

/**
 * Command: skill front conversation <id>
 * Fetch conversation details and optionally messages
 */
async function getConversation(
  id: string,
  options: { json?: boolean; messages?: boolean }
): Promise<void> {
  try {
    const front = getFrontClient()
    const conversation = await front.conversations.get(normalizeId(id))

    // Fetch messages if requested
    let messages: Message[] | undefined
    if (options.messages) {
      const messageList = (await front.conversations.listMessages(
        normalizeId(id)
      )) as MessageList
      messages = messageList._results ?? []
    }

    if (options.json) {
      const convId = normalizeId(id)
      writeJsonOutput(
        hateoasWrap({
          type: 'conversation',
          command: `skill front conversation ${convId} --json`,
          data: { conversation, messages },
          links: conversationLinks(conversation.id),
          actions: conversationActions(conversation.id),
        })
      )
      return
    }

    console.log('\n💬 Conversation Details:')
    console.log(`   ID:       ${conversation.id}`)
    console.log(`   Subject:  ${conversation.subject || '(none)'}`)
    console.log(`   Status:   ${conversation.status}`)
    console.log(`   Created:  ${formatTimestamp(conversation.created_at)}`)

    if (conversation.recipient) {
      console.log(`   Recipient: ${conversation.recipient.handle}`)
    }

    if (conversation.assignee) {
      console.log(`   Assignee: ${conversation.assignee.email}`)
    }

    if (conversation.tags && conversation.tags.length > 0) {
      console.log(
        `   Tags:     ${conversation.tags.map((t: { name: string }) => t.name).join(', ')}`
      )
    }

    if (options.messages && messages) {
      console.log(`\n📨 Messages (${messages.length}):`)
      console.log('-'.repeat(80))

      for (const msg of messages) {
        const direction = msg.is_inbound ? '← IN' : '→ OUT'
        const author = msg.author?.email || 'unknown'
        const time = formatTimestamp(msg.created_at)
        const textBody =
          msg.text ||
          msg.body
            .replace(/<[^>]*>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()

        console.log(`\n[${direction}] ${time} - ${author}`)
        console.log(`   ${truncate(textBody, 200)}`)
      }
    } else if (!options.messages) {
      console.log('\n   (use --messages to see message history)')
    }

    console.log('')
  } catch (error) {
    if (options.json) {
      console.error(
        JSON.stringify({
          error: error instanceof Error ? error.message : 'Unknown error',
        })
      )
    } else {
      console.error(
        'Error:',
        error instanceof Error ? error.message : 'Unknown error'
      )
    }
    process.exit(1)
  }
}

/**
 * Command: skill front teammates
 * List all teammates in the workspace
 */
async function listTeammates(options: { json?: boolean }): Promise<void> {
  try {
    const front = getFrontSdkClient()
    const result = await front.teammates.list()

    if (options.json) {
      writeJsonOutput(
        hateoasWrap({
          type: 'teammate-list',
          command: 'skill front teammates --json',
          data: result._results,
          links: teammateListLinks(
            result._results.map((t) => ({ id: t.id, email: t.email }))
          ),
        })
      )
      return
    }

    console.log('\n👥 Teammates:')
    console.log('-'.repeat(60))

    for (const teammate of result._results) {
      const available = teammate.is_available ? '✓' : '✗'
      console.log(`   ${available} ${teammate.id}`)
      console.log(`      Email: ${teammate.email}`)
      if (teammate.first_name || teammate.last_name) {
        console.log(
          `      Name:  ${teammate.first_name || ''} ${teammate.last_name || ''}`.trim()
        )
      }
      if (teammate.username) {
        console.log(`      Username: ${teammate.username}`)
      }
      console.log('')
    }
  } catch (error) {
    if (options.json) {
      console.error(
        JSON.stringify({
          error: error instanceof Error ? error.message : 'Unknown error',
        })
      )
    } else {
      console.error(
        'Error:',
        error instanceof Error ? error.message : 'Unknown error'
      )
    }
    process.exit(1)
  }
}

/**
 * Command: skill front teammate <id>
 * Get a specific teammate by ID
 */
async function getTeammate(
  id: string,
  options: { json?: boolean }
): Promise<void> {
  try {
    const front = getFrontSdkClient()
    const teammate = await front.teammates.get(id)

    if (options.json) {
      writeJsonOutput(
        hateoasWrap({
          type: 'teammate',
          command: `skill front teammate ${id} --json`,
          data: teammate,
          links: teammateLinks(teammate.id),
        })
      )
      return
    }

    console.log('\n👤 Teammate Details:')
    console.log(`   ID:        ${teammate.id}`)
    console.log(`   Email:     ${teammate.email}`)
    if (teammate.first_name || teammate.last_name) {
      console.log(
        `   Name:      ${teammate.first_name || ''} ${teammate.last_name || ''}`.trim()
      )
    }
    if (teammate.username) {
      console.log(`   Username:  ${teammate.username}`)
    }
    console.log(`   Available: ${teammate.is_available ? 'Yes' : 'No'}`)
    console.log('')
  } catch (error) {
    if (options.json) {
      console.error(
        JSON.stringify({
          error: error instanceof Error ? error.message : 'Unknown error',
        })
      )
    } else {
      console.error(
        'Error:',
        error instanceof Error ? error.message : 'Unknown error'
      )
    }
    process.exit(1)
  }
}

/**
 * Register Front commands with Commander
 */
export function registerFrontCommands(program: Command): void {
  const front = program
    .command('front')
    .description('Front conversations, inboxes, tags, archival, and reporting')

  const messageCmd = front
    .command('message')
    .description('Get a message by ID (body, author, recipients, attachments)')
    .argument('<id>', 'Message ID (e.g., msg_xxx)')
    .option('--json', 'Output as JSON')
    .action(getMessage)

  messageCmd.addHelpText(
    'after',
    `
━━━ Message Details ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Fetches a single message from Front by its ID. Returns the full message
  including HTML body, plaintext body, author, recipients, attachments,
  and metadata.

ID FORMAT
  msg_xxx     Front message ID (prefixed with msg_)
              You can find message IDs from conversation message lists.

WHAT'S RETURNED
  Field        Description
  ──────────── ──────────────────────────────────────────────────────────
  id           Message ID (msg_xxx)
  type         Message type (email, sms, custom, etc.)
  subject      Message subject line
  body         Full HTML body
  text         Plaintext body (stripped HTML)
  author       Author object (email, id) — teammate or contact
  recipients   Array of {role, handle} — from/to/cc/bcc
  attachments  Array of {filename, content_type, size, url}
  created_at   Unix timestamp of message creation
  metadata     Headers, external references

JSON + jq PATTERNS
  # Get the HTML body
  skill front message msg_xxx --json | jq '.data.body'

  # Get the plaintext body
  skill front message msg_xxx --json | jq '.data.text'

  # Get the author email
  skill front message msg_xxx --json | jq '.data.author.email'

  # List all recipients
  skill front message msg_xxx --json | jq '.data.recipients[] | {role, handle}'

  # List attachment filenames
  skill front message msg_xxx --json | jq '.data.attachments[].filename'

RELATED COMMANDS
  skill front conversation <id> -m   Find message IDs from a conversation
  skill front search <query>         Search conversations to find threads

EXAMPLES
  # Get full message details (human-readable)
  skill front message msg_1a2b3c

  # Get message as JSON for piping
  skill front message msg_1a2b3c --json

  # Extract just the body text
  skill front message msg_1a2b3c --json | jq -r '.data.text'

  # Check who sent a message
  skill front message msg_1a2b3c --json | jq '{author: .data.author.email, recipients: [.data.recipients[].handle]}'
`
  )

  const conversationCmd = front
    .command('conversation')
    .description('Get a conversation by ID (status, tags, assignee, messages)')
    .argument('<id>', 'Conversation ID (e.g., cnv_xxx)')
    .option('--json', 'Output as JSON')
    .option('-m, --messages', 'Include message history')
    .action(getConversation)

  conversationCmd.addHelpText(
    'after',
    `
━━━ Conversation Details ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Fetches a conversation from Front by its ID. Returns metadata, tags,
  assignee, recipient, and optionally the full message history.

ID FORMAT
  cnv_xxx     Front conversation ID (prefixed with cnv_)
              Find conversation IDs via search or inbox listing.

FLAGS
  -m, --messages    Include full message history in the response.
                    Without this flag, only conversation metadata is returned.

WHAT'S RETURNED
  Field        Description
  ──────────── ──────────────────────────────────────────────────────────
  id           Conversation ID (cnv_xxx)
  subject      Conversation subject line
  status       Current status (see below)
  created_at   Unix timestamp
  recipient    Primary recipient {handle, role}
  assignee     Assigned teammate {id, email} or null
  tags         Array of {id, name} tags on this conversation
  messages     (with -m) Array of full message objects

STATUS VALUES
  archived     Conversation is archived
  unassigned   Open, no assignee
  assigned     Open, has an assignee
  deleted      In trash
  waiting      Waiting for response

JSON + jq PATTERNS
  # Get conversation metadata
  skill front conversation cnv_xxx --json | jq '.data.conversation'

  # Get all messages (requires -m flag)
  skill front conversation cnv_xxx -m --json | jq '.data.messages[]'

  # Get just message bodies as plaintext
  skill front conversation cnv_xxx -m --json | jq -r '.data.messages[].text'

  # Extract tag names
  skill front conversation cnv_xxx --json | jq '[.data.conversation.tags[].name]'

  # Get assignee email
  skill front conversation cnv_xxx --json | jq '.data.conversation.assignee.email'

  # Get message count
  skill front conversation cnv_xxx -m --json | jq '.data.messages | length'

  # Get inbound messages only
  skill front conversation cnv_xxx -m --json | jq '[.data.messages[] | select(.is_inbound)]'

RELATED COMMANDS
  skill front message <id>           Get full details for a specific message
  skill front assign <cnv> <tea>     Assign conversation to a teammate
  skill front tag <cnv> <tag>        Add a tag to a conversation
  skill front reply <cnv>            Send a reply to a conversation
  skill front search <query>         Search for conversations

EXAMPLES
  # Get conversation overview
  skill front conversation cnv_abc123

  # Get conversation with full message history
  skill front conversation cnv_abc123 -m

  # Pipe to jq to extract tags and assignee
  skill front conversation cnv_abc123 --json | jq '{tags: [.data.conversation.tags[].name], assignee: .data.conversation.assignee.email}'

  # Get the latest message text from a conversation
  skill front conversation cnv_abc123 -m --json | jq -r '.data.messages[-1].text'
`
  )

  const teammatesCmd = front
    .command('teammates')
    .description('List all teammates in the workspace')
    .option('--json', 'Output as JSON')
    .action(listTeammates)

  teammatesCmd.addHelpText(
    'after',
    `
━━━ List Teammates ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Lists all teammates in the Front workspace. Returns each teammate's ID,
  email, name, username, and availability status.

WHAT'S RETURNED (per teammate)
  Field          Description
  ────────────── ──────────────────────────────────────────────────────────
  id             Teammate ID (tea_xxx)
  email          Teammate email address
  first_name     First name
  last_name      Last name
  username       Front username
  is_available   Whether teammate is currently available (true/false)

JSON + jq PATTERNS
  # Get all teammate IDs
  skill front teammates --json | jq '[.data[].id]'

  # Get ID + email pairs
  skill front teammates --json | jq '.data[] | {id, email}'

  # Find a teammate by email
  skill front teammates --json | jq '.data[] | select(.email == "joel@example.com")'

  # List only available teammates
  skill front teammates --json | jq '[.data[] | select(.is_available)]'

  # Get a count of teammates
  skill front teammates --json | jq '.data | length'

RELATED COMMANDS
  skill front teammate <id>          Get details for a specific teammate
  skill front assign <cnv> <tea>     Assign a conversation to a teammate

EXAMPLES
  # List all teammates (human-readable table)
  skill front teammates

  # List as JSON for scripting
  skill front teammates --json

  # Find teammate ID by email for use in assign
  skill front teammates --json | jq -r '.data[] | select(.email | contains("joel")) | .id'
`
  )

  const teammateCmd = front
    .command('teammate')
    .description('Get teammate details by ID')
    .argument('<id>', 'Teammate ID (e.g., tea_xxx or username)')
    .option('--json', 'Output as JSON')
    .action(getTeammate)

  teammateCmd.addHelpText(
    'after',
    `
━━━ Teammate Details ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Fetches details for a single teammate by their ID. Returns email, name,
  username, and current availability.

ID FORMAT
  tea_xxx     Front teammate ID (prefixed with tea_)
              Find teammate IDs via: skill front teammates

WHAT'S RETURNED
  Field          Description
  ────────────── ──────────────────────────────────────────────────────────
  id             Teammate ID (tea_xxx)
  email          Teammate email address
  first_name     First name
  last_name      Last name
  username       Front username
  is_available   Whether teammate is currently available (true/false)

JSON + jq PATTERNS
  # Get teammate email
  skill front teammate tea_xxx --json | jq '.data.email'

  # Get full name
  skill front teammate tea_xxx --json | jq '(.data.first_name + " " + .data.last_name)'

  # Check availability
  skill front teammate tea_xxx --json | jq '.data.is_available'

RELATED COMMANDS
  skill front teammates              List all teammates (to find IDs)
  skill front assign <cnv> <tea>     Assign a conversation to this teammate

EXAMPLES
  # Get teammate details (human-readable)
  skill front teammate tea_1a2b3c

  # Get as JSON
  skill front teammate tea_1a2b3c --json

  # Quick check if teammate is available
  skill front teammate tea_1a2b3c --json | jq -r 'if .data.is_available then "available" else "away" end'
`
  )

  // Register inbox, archive, report, triage commands
  registerInboxCommand(front)
  registerArchiveCommand(front)
  registerBulkArchiveCommand(front)
  registerReportCommand(front)
  registerTriageCommand(front)

  // Register pull command for building eval datasets
  registerPullCommand(front)

  // Register tag management commands
  registerTagCommands(front)

  // Register assign, conversation tag/untag, reply, search, and API passthrough
  registerAssignCommand(front)
  registerConversationTagCommands(front)
  registerReplyCommand(front)
  registerSearchCommand(front)
  registerApiCommand(front)
}
