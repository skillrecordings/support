import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMcpServer } from '../../../src/mcp/server'

const mockCreateInstrumentedFrontClient = vi.hoisted(() => vi.fn())

vi.mock('@skillrecordings/core/front/instrumented-client', () => ({
  createInstrumentedFrontClient: mockCreateInstrumentedFrontClient,
}))

type MockFrontClient = {
  inboxes: { list: ReturnType<typeof vi.fn> }
}

const createFrontMock = (): MockFrontClient => ({
  inboxes: { list: vi.fn() },
})

type JsonRpcResponse = {
  jsonrpc: '2.0'
  id: number | string | null
  result?: unknown
  error?: { code: number; message: string }
}

const createRpcHarness = () => {
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  const stderr = new PassThrough()

  let buffer = ''
  const pending = new Map<
    string | number | null,
    (value: JsonRpcResponse) => void
  >()

  stdout.on('data', (chunk) => {
    buffer += chunk.toString()
    let index = buffer.indexOf('\n')
    while (index !== -1) {
      const line = buffer.slice(0, index).trim()
      buffer = buffer.slice(index + 1)
      if (line.length > 0) {
        const payload = JSON.parse(line) as JsonRpcResponse
        const resolver = pending.get(payload.id)
        if (resolver) {
          pending.delete(payload.id)
          resolver(payload)
        }
      }
      index = buffer.indexOf('\n')
    }
  })

  const send = (payload: Record<string, unknown>): Promise<JsonRpcResponse> => {
    const id = payload.id as JsonRpcResponse['id']
    const promise = new Promise<JsonRpcResponse>((resolve) => {
      pending.set(id ?? null, resolve)
    })
    stdin.write(`${JSON.stringify(payload)}\n`)
    return promise
  }

  return { stdin, stdout, stderr, send }
}

describe('mcp server', () => {
  const originalFrontToken = process.env.FRONT_API_TOKEN

  beforeEach(() => {
    process.env.FRONT_API_TOKEN = 'test-front-token'
    mockCreateInstrumentedFrontClient.mockReset()
  })

  afterEach(() => {
    if (originalFrontToken === undefined) {
      delete process.env.FRONT_API_TOKEN
    } else {
      process.env.FRONT_API_TOKEN = originalFrontToken
    }
  })

  it('handles initialize handshake', async () => {
    const { stdin, stdout, stderr, send } = createRpcHarness()
    const server = createMcpServer({ stdin, stdout, stderr })

    const startPromise = server.start()

    const response = await send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        clientInfo: { name: 'test', version: '0.0.0' },
      },
    })

    expect(response.result).toBeTruthy()
    const result = response.result as {
      protocolVersion: string
      serverInfo: { name: string }
    }
    expect(result.protocolVersion).toBeTruthy()
    expect(result.serverInfo.name).toBe('skill')

    server.stop()
    await startPromise
  })

  it('lists tools', async () => {
    const { stdin, stdout, stderr, send } = createRpcHarness()
    const server = createMcpServer({ stdin, stdout, stderr })

    const startPromise = server.start()

    const response = await send({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
    })

    const result = response.result as { tools: Array<{ name: string }> }
    expect(result.tools.length).toBeGreaterThan(0)
    expect(result.tools.some((tool) => tool.name === 'front_inbox_list')).toBe(
      true
    )

    server.stop()
    await startPromise
  })

  it('executes tools/call for front_inbox_list', async () => {
    const front = createFrontMock()
    front.inboxes.list.mockResolvedValue({
      _results: [{ id: 'inb_1', name: 'Support', is_private: false }],
    })
    mockCreateInstrumentedFrontClient.mockReturnValue(front)

    const { stdin, stdout, stderr, send } = createRpcHarness()
    const server = createMcpServer({ stdin, stdout, stderr })

    const startPromise = server.start()

    const response = await send({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'front_inbox_list', arguments: {} },
    })

    const result = response.result as {
      isError?: boolean
      content: Array<{ type: 'json'; json: { _type: string } }>
    }

    expect(result.isError).toBeUndefined()
    expect(result.content[0]?.type).toBe('json')
    expect(result.content[0]?.json._type).toBe('inbox-list')

    server.stop()
    await startPromise
  })

  it('returns JSON-RPC error for unknown tool', async () => {
    const { stdin, stdout, stderr, send } = createRpcHarness()
    const server = createMcpServer({ stdin, stdout, stderr })

    const startPromise = server.start()

    const response = await send({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'front_unknown', arguments: {} },
    })

    expect(response.error).toBeTruthy()
    expect(response.error?.code).toBe(-32601)

    server.stop()
    await startPromise
  })
})
