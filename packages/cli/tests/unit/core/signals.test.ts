import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSignalManager } from '../../../src/core/signals'

const nextTick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

describe('createSignalManager', () => {
  const originalExitCode = process.exitCode

  afterEach(() => {
    process.exitCode = originalExitCode
  })

  it('runs cleanup callbacks in reverse order for SIGINT', async () => {
    const exitSpy = vi.fn()
    const manager = createSignalManager({ exit: exitSpy, signals: ['SIGINT'] })
    const calls: string[] = []

    manager.onCleanup(() => calls.push('first'))
    manager.onCleanup(async () => {
      calls.push('second')
    })
    manager.onCleanup(() => calls.push('third'))

    process.emit('SIGINT')
    await nextTick()

    expect(calls).toEqual(['third', 'second', 'first'])
    expect(exitSpy).toHaveBeenCalledWith(130)
    expect(manager.signal.aborted).toBe(true)

    manager.dispose()
  })

  it('uses SIGTERM exit code 143', async () => {
    const exitSpy = vi.fn()
    const manager = createSignalManager({ exit: exitSpy, signals: ['SIGTERM'] })

    process.emit('SIGTERM')
    await nextTick()

    expect(exitSpy).toHaveBeenCalledWith(143)
    expect(process.exitCode).toBe(143)

    manager.dispose()
  })

  it('force exits on second SIGINT', async () => {
    const exitSpy = vi.fn()
    let releaseCleanup: (() => void) | undefined

    const manager = createSignalManager({ exit: exitSpy, signals: ['SIGINT'] })
    manager.onCleanup(
      () =>
        new Promise<void>((resolve) => {
          releaseCleanup = resolve
        })
    )

    process.emit('SIGINT')
    process.emit('SIGINT')

    expect(exitSpy).toHaveBeenCalledWith(130)

    releaseCleanup?.()
    await nextTick()

    expect(exitSpy).toHaveBeenCalledTimes(1)

    manager.dispose()
  })
})
