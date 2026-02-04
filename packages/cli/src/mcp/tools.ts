import { PassThrough } from 'node:stream'
import { runFrontApi } from '../commands/front/api'
import { archiveConversations } from '../commands/front/archive'
import { assignConversation } from '../commands/front/assign'
import {
  tagConversation,
  untagConversation,
} from '../commands/front/conversation-tags'
import { listConversations, listInboxes } from '../commands/front/inbox'
import { getConversation } from '../commands/front/index'
import { replyToConversation } from '../commands/front/reply'
import { type CommandContext, createContext } from '../core/context'

export interface McpTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export type McpToolContent =
  | { type: 'json'; json: unknown }
  | { type: 'text'; text: string }

export interface McpToolResult {
  content: McpToolContent[]
  isError?: boolean
}

export const tools: McpTool[] = [
  {
    name: 'front_inbox_list',
    description: 'List Front inboxes',
    inputSchema: {
      type: 'object',
      properties: {
        json: { type: 'boolean' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'front_inbox_conversations',
    description: 'List conversations in a Front inbox',
    inputSchema: {
      type: 'object',
      properties: {
        inbox: { type: 'string', description: 'Inbox name or ID' },
        status: {
          type: 'string',
          enum: ['unassigned', 'assigned', 'archived'],
        },
        limit: { type: 'number', default: 25 },
      },
      required: ['inbox'],
      additionalProperties: false,
    },
  },
  {
    name: 'front_conversation_get',
    description: 'Get conversation details with messages',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Conversation ID (cnv_xxx)' },
        messages: { type: 'boolean', default: false },
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'front_assign',
    description: 'Assign or unassign a conversation',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        to: { type: 'string', description: 'Teammate ID (tea_xxx)' },
        unassign: { type: 'boolean' },
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'front_reply',
    description: 'Draft a reply on a conversation (creates draft, never sends)',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        message: { type: 'string' },
      },
      required: ['id', 'message'],
      additionalProperties: false,
    },
  },
  {
    name: 'front_archive',
    description: 'Archive a conversation',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'front_tag',
    description: 'Add or remove a tag on a conversation',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        tag: { type: 'string' },
        remove: { type: 'boolean', default: false },
      },
      required: ['id', 'tag'],
      additionalProperties: false,
    },
  },
  {
    name: 'front_search',
    description: 'Search Front conversations',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        limit: { type: 'number', default: 25 },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'front_api',
    description:
      'Raw Front API passthrough (GET only unless --allow-destructive)',
    inputSchema: {
      type: 'object',
      properties: {
        method: { type: 'string', enum: ['GET', 'POST', 'PATCH', 'DELETE'] },
        path: { type: 'string' },
        data: { type: 'string', description: 'JSON body for POST/PATCH' },
        allowDestructive: { type: 'boolean', default: false },
      },
      required: ['method', 'path'],
      additionalProperties: false,
    },
  },
]

const toolHandlers: Record<
  string,
  (ctx: CommandContext, params: Record<string, unknown>) => Promise<void>
> = {
  front_inbox_list: async (ctx) => {
    await listInboxes(ctx, { json: true })
  },
  front_inbox_conversations: async (ctx, params) => {
    const inbox = typeof params.inbox === 'string' ? params.inbox : ''
    const status =
      params.status === 'unassigned' ||
      params.status === 'assigned' ||
      params.status === 'archived'
        ? params.status
        : undefined
    const limit =
      typeof params.limit === 'number'
        ? String(params.limit)
        : typeof params.limit === 'string'
          ? params.limit
          : undefined

    await listConversations(ctx, inbox, {
      json: true,
      status,
      limit,
    })
  },
  front_conversation_get: async (ctx, params) => {
    const id = typeof params.id === 'string' ? params.id : ''
    const messages = params.messages === true

    await getConversation(ctx, id, {
      json: true,
      messages,
    })
  },
  front_assign: async (ctx, params) => {
    const id = typeof params.id === 'string' ? params.id : ''
    const to = typeof params.to === 'string' ? params.to : undefined
    const unassign = params.unassign === true

    await assignConversation(ctx, id, {
      json: true,
      to,
      unassign,
    })
  },
  front_reply: async (ctx, params) => {
    const id = typeof params.id === 'string' ? params.id : ''
    const message = typeof params.message === 'string' ? params.message : ''

    await replyToConversation(ctx, id, {
      json: true,
      message,
    })
  },
  front_archive: async (ctx, params) => {
    const id = typeof params.id === 'string' ? params.id : ''

    await archiveConversations(ctx, id, [], {
      json: true,
    })
  },
  front_tag: async (ctx, params) => {
    const id = typeof params.id === 'string' ? params.id : ''
    const tag = typeof params.tag === 'string' ? params.tag : ''
    const remove = params.remove === true

    if (remove) {
      await untagConversation(ctx, id, {
        json: true,
        tag,
      })
      return
    }

    await tagConversation(ctx, id, {
      json: true,
      tag,
    })
  },
  front_search: async (ctx, params) => {
    const query = typeof params.query === 'string' ? params.query : ''
    const limit =
      typeof params.limit === 'number'
        ? params.limit
        : typeof params.limit === 'string'
          ? Number(params.limit)
          : undefined
    const encodedQuery = encodeURIComponent(query)
    const path = Number.isFinite(limit)
      ? `/conversations/search/${encodedQuery}?limit=${limit}`
      : `/conversations/search/${encodedQuery}`

    await runFrontApi(ctx, 'GET', path, {
      json: true,
    })
  },
  front_api: async (ctx, params) => {
    const method = typeof params.method === 'string' ? params.method : ''
    const path = typeof params.path === 'string' ? params.path : ''
    const data = typeof params.data === 'string' ? params.data : undefined
    const allowDestructive = params.allowDestructive === true

    await runFrontApi(ctx, method, path, {
      json: true,
      data,
      allowDestructive,
    })
  },
}

const stdoutKey = Symbol('stdout')
const stderrKey = Symbol('stderr')

type ToolContext = CommandContext & {
  [stdoutKey]: PassThrough
  [stderrKey]: PassThrough
}

async function createToolContext(): Promise<ToolContext> {
  const stdoutStream = new PassThrough()
  const stderrStream = new PassThrough()

  const ctx = (await createContext({
    stdout: stdoutStream as unknown as NodeJS.WriteStream,
    stderr: stderrStream as unknown as NodeJS.WriteStream,
    format: 'json',
    verbose: false,
    quiet: false,
  })) as ToolContext
  ;(ctx as ToolContext)[stdoutKey] = stdoutStream
  ;(ctx as ToolContext)[stderrKey] = stderrStream

  return ctx
}

function captureOutput(stream: PassThrough): Promise<string> {
  return new Promise((resolve) => {
    let buffer = ''
    stream.on('data', (chunk) => {
      buffer += chunk.toString()
    })
    stream.on('end', () => resolve(buffer))
    stream.on('close', () => resolve(buffer))
    stream.on('finish', () => resolve(buffer))
  })
}

function parseJsonOutput(stdout: string): unknown | null {
  const lines = stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i]
    if (!line) continue
    try {
      return JSON.parse(line)
    } catch {
      continue
    }
  }

  return null
}

function formatErrorContent(message: string): McpToolResult {
  return {
    isError: true,
    content: [{ type: 'text', text: message }],
  }
}

export function listTools(): McpTool[] {
  return tools
}

export async function callTool(
  name: string,
  params: Record<string, unknown> | undefined
): Promise<McpToolResult> {
  const handler = toolHandlers[name]
  if (!handler) {
    return formatErrorContent(`Unknown tool: ${name}`)
  }

  const args = params ?? {}
  const previousExitCode = process.exitCode
  process.exitCode = undefined

  const ctx = await createToolContext()
  const stdout = ctx[stdoutKey]
  const stderr = ctx[stderrKey]

  const stdoutPromise = captureOutput(stdout)
  const stderrPromise = captureOutput(stderr)

  let errorMessage: string | null = null

  try {
    await handler(ctx, args)
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error)
  } finally {
    stdout.end()
    stderr.end()
  }

  const [stdoutBuffer, stderrBuffer] = await Promise.all([
    stdoutPromise,
    stderrPromise,
  ])

  const exitCode = process.exitCode
  process.exitCode = previousExitCode

  if (errorMessage) {
    return formatErrorContent(errorMessage)
  }

  if (exitCode && exitCode !== 0) {
    const errorText = stderrBuffer.trim() || 'Tool execution failed.'
    return formatErrorContent(errorText)
  }

  const parsed = parseJsonOutput(stdoutBuffer)
  if (parsed !== null) {
    return {
      content: [{ type: 'json', json: parsed }],
    }
  }

  const fallback = stderrBuffer.trim() || 'No output captured from tool.'
  return {
    content: [{ type: 'text', text: fallback }],
  }
}

export function hasTool(name: string): boolean {
  return Boolean(toolHandlers[name])
}

export function getToolNames(): string[] {
  return tools.map((tool) => tool.name)
}
