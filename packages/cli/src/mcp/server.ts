import { createInterface } from 'node:readline'
import type { Readable, Writable } from 'node:stream'
import { callTool, hasTool, listTools } from './tools'

export interface McpTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface McpServer {
  start(): Promise<void>
  stop(): void
}

type JsonRpcId = number | string | null

type JsonRpcRequest = {
  jsonrpc: '2.0'
  method: string
  params?: unknown
  id?: JsonRpcId
}

type JsonRpcResponse = {
  jsonrpc: '2.0'
  id: JsonRpcId
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

type JsonRpcNotification = {
  jsonrpc: '2.0'
  method: string
  params?: unknown
}

const MCP_PROTOCOL_VERSION = '2024-11-05'

export function createMcpServer(
  options: {
    stdin?: Readable
    stdout?: Writable
    stderr?: Writable
  } = {}
): McpServer {
  const stdin = options.stdin ?? process.stdin
  const stdout = options.stdout ?? process.stdout
  const stderr = options.stderr ?? process.stderr

  let stopped = false
  let resolveStop: (() => void) | null = null
  let removeSigterm: (() => void) | null = null
  let rl: ReturnType<typeof createInterface> | null = null

  const writeResponse = (response: JsonRpcResponse) => {
    stdout.write(`${JSON.stringify(response)}\n`)
  }

  const writeError = (id: JsonRpcId, code: number, message: string) => {
    writeResponse({
      jsonrpc: '2.0',
      id,
      error: { code, message },
    })
  }

  const handleInitialize = (request: JsonRpcRequest) => {
    const response: JsonRpcResponse = {
      jsonrpc: '2.0',
      id: request.id ?? null,
      result: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        serverInfo: {
          name: 'skill',
          version: process.env.npm_package_version ?? 'dev',
        },
        capabilities: {
          tools: {
            listChanged: false,
          },
        },
      },
    }

    writeResponse(response)
  }

  const handleToolsList = (request: JsonRpcRequest) => {
    writeResponse({
      jsonrpc: '2.0',
      id: request.id ?? null,
      result: { tools: listTools() },
    })
  }

  const handleToolsCall = async (request: JsonRpcRequest) => {
    const params =
      typeof request.params === 'object' && request.params !== null
        ? (request.params as { name?: unknown; arguments?: unknown })
        : {}
    const toolName = typeof params.name === 'string' ? params.name : ''
    const toolArgs =
      typeof params.arguments === 'object' && params.arguments !== null
        ? (params.arguments as Record<string, unknown>)
        : undefined

    if (!toolName) {
      writeError(request.id ?? null, -32600, 'Missing tool name.')
      return
    }

    if (!hasTool(toolName)) {
      writeError(request.id ?? null, -32601, `Unknown tool: ${toolName}`)
      return
    }

    const result = await callTool(toolName, toolArgs)
    writeResponse({
      jsonrpc: '2.0',
      id: request.id ?? null,
      result,
    })
  }

  const handleRequest = async (request: JsonRpcRequest) => {
    if (!request.jsonrpc || request.jsonrpc !== '2.0') {
      writeError(request.id ?? null, -32600, 'Invalid JSON-RPC version.')
      return
    }

    switch (request.method) {
      case 'initialize':
        handleInitialize(request)
        return
      case 'tools/list':
        handleToolsList(request)
        return
      case 'tools/call':
        await handleToolsCall(request)
        return
      case 'notifications/initialized':
        return
      default:
        if (request.id !== undefined) {
          writeError(request.id ?? null, -32601, 'Method not found.')
        }
    }
  }

  const handleLine = async (line: string) => {
    const trimmed = line.trim()
    if (!trimmed) return

    let payload: JsonRpcRequest | JsonRpcNotification
    try {
      payload = JSON.parse(trimmed) as JsonRpcRequest | JsonRpcNotification
    } catch {
      writeError(null, -32700, 'Parse error.')
      return
    }

    if (typeof payload !== 'object' || payload === null) {
      writeError(null, -32600, 'Invalid Request.')
      return
    }

    if (!('method' in payload) || typeof payload.method !== 'string') {
      writeError(null, -32600, 'Invalid Request.')
      return
    }

    const isNotification = !('id' in payload)

    if (isNotification) {
      if (payload.method === 'notifications/initialized') return
      return
    }

    await handleRequest(payload as JsonRpcRequest)
  }

  const stop = () => {
    if (stopped) return
    stopped = true

    if (rl) {
      rl.close()
      rl = null
    }

    if (removeSigterm) {
      removeSigterm()
      removeSigterm = null
    }

    if (resolveStop) {
      resolveStop()
      resolveStop = null
    }
  }

  const start = () => {
    if (rl) {
      return Promise.resolve()
    }

    rl = createInterface({ input: stdin, crlfDelay: Infinity })
    rl.on('line', (line) => {
      void handleLine(line)
    })
    rl.on('close', () => {
      stop()
    })

    const onSigterm = () => stop()
    process.once('SIGTERM', onSigterm)
    removeSigterm = () => process.off('SIGTERM', onSigterm)

    return new Promise<void>((resolve) => {
      resolveStop = resolve
    })
  }

  return { start, stop }
}
