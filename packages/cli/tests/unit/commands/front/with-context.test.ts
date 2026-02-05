import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockCreateContext = vi.hoisted(() => vi.fn())

vi.mock('../../../../src/core/context', () => ({
  createContext: mockCreateContext,
}))

import { contextFromCommand } from '../../../../src/commands/front/with-context'

describe('contextFromCommand', () => {
  beforeEach(() => {
    mockCreateContext.mockReset()
  })

  it('uses optsWithGlobals when available', async () => {
    const command = {
      optsWithGlobals: () => ({
        format: 'table',
        verbose: true,
        quiet: false,
      }),
    }
    const mockCtx = { id: 'ctx' }
    mockCreateContext.mockResolvedValue(mockCtx)

    const result = await contextFromCommand(command as any)

    expect(mockCreateContext).toHaveBeenCalledWith({
      format: 'table',
      verbose: true,
      quiet: false,
    })
    expect(result).toBe(mockCtx)
  })

  it('falls back to parent and command opts when optsWithGlobals is missing', async () => {
    const command = {
      parent: {
        opts: () => ({
          format: 'text',
          verbose: false,
          quiet: true,
        }),
      },
      opts: () => ({
        format: 'json',
        verbose: true,
      }),
    }
    mockCreateContext.mockResolvedValue({ ok: true })

    await contextFromCommand(command as any)

    expect(mockCreateContext).toHaveBeenCalledWith({
      format: 'json',
      verbose: true,
      quiet: true,
    })
  })

  it('overrides format to json when json option is set', async () => {
    const command = {
      optsWithGlobals: () => ({
        format: 'text',
        verbose: false,
        quiet: false,
      }),
    }
    mockCreateContext.mockResolvedValue({ ok: true })

    await contextFromCommand(command as any, { json: true })

    expect(mockCreateContext).toHaveBeenCalledWith({
      format: 'json',
      verbose: false,
      quiet: false,
    })
  })

  it('propagates verbose and quiet flags', async () => {
    const command = {
      optsWithGlobals: () => ({
        format: 'text',
        verbose: true,
        quiet: true,
      }),
    }
    mockCreateContext.mockResolvedValue({ ok: true })

    await contextFromCommand(command as any)

    expect(mockCreateContext).toHaveBeenCalledWith({
      format: 'text',
      verbose: true,
      quiet: true,
    })
  })
})
