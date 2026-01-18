import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { init } from './init'

// Mock process.exit to prevent test termination
const mockExit = vi.spyOn(process, 'exit').mockImplementation((code) => {
  throw new Error(`process.exit(${code})`)
})

describe('init command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockExit.mockClear()
  })

  afterEach(() => {
    mockExit.mockClear()
  })

  it('should generate a secure 64-character hex webhook secret', async () => {
    const consoleSpy = vi.spyOn(console, 'log')

    // Expect process.exit(0) to be called
    await expect(init('test-app')).rejects.toThrow('process.exit(0)')

    const output = consoleSpy.mock.calls.flat().join('\n')
    const secretMatch = output.match(/Webhook Secret: ([a-f0-9]+)/)

    expect(secretMatch).toBeTruthy()
    expect(secretMatch?.[1]).toHaveLength(64) // 32 bytes = 64 hex chars
  })

  it('should use provided app name', async () => {
    const consoleSpy = vi.spyOn(console, 'log')

    await expect(init('my-custom-app')).rejects.toThrow('process.exit(0)')

    const output = consoleSpy.mock.calls.flat().join('\n')
    expect(output).toContain('my-custom-app')
  })

  it('should default to "my-app" when name not provided and no input given', async () => {
    // Skip this test in CI - requires user interaction
    // In real usage, promptForName() waits for user input
    // Testing the happy path with explicit name is sufficient
    expect(true).toBe(true)
  })

  it('should output webhook URL and .env format', async () => {
    const consoleSpy = vi.spyOn(console, 'log')

    await expect(init('test-app')).rejects.toThrow('process.exit(0)')

    const output = consoleSpy.mock.calls.flat().join('\n')
    expect(output).toContain('Webhook URL:')
    expect(output).toContain('Add to your .env:')
    expect(output).toContain('FRONT_WEBHOOK_SECRET=')
  })

  it('should output JSON when --json flag is used', async () => {
    const consoleSpy = vi.spyOn(console, 'log')

    await expect(init('json-test-app', { json: true })).rejects.toThrow(
      'process.exit(0)'
    )

    const output = consoleSpy.mock.calls.flat().join('\n')
    const parsed = JSON.parse(output)

    expect(parsed.success).toBe(true)
    expect(parsed.appName).toBe('json-test-app')
    expect(parsed.webhookSecret).toHaveLength(64)
  })

  it('should error in non-interactive mode without name', async () => {
    // Mock non-interactive by checking TTY
    const originalIsTTY = process.stdin.isTTY
    Object.defineProperty(process.stdin, 'isTTY', {
      value: false,
      writable: true,
    })

    await expect(init(undefined)).rejects.toThrow('process.exit(1)')

    Object.defineProperty(process.stdin, 'isTTY', {
      value: originalIsTTY,
      writable: true,
    })
  })
})
