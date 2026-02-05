export type CleanupFn = () => void | Promise<void>

export interface SignalManager {
  signal: AbortSignal
  onCleanup: (fn: CleanupFn) => void
  dispose: () => void
}

export interface SignalManagerOptions {
  signals?: NodeJS.Signals[]
  exit?: (code: number) => void
}

export function createSignalManager(
  options: SignalManagerOptions = {}
): SignalManager {
  const abortController = new AbortController()
  const cleanupCallbacks: CleanupFn[] = []
  const signalList = options.signals ?? ['SIGINT', 'SIGTERM']
  const exitFn = options.exit ?? ((code: number) => process.exit(code))

  let handling = false
  let forcedExit = false

  const runCleanup = async () => {
    for (let index = cleanupCallbacks.length - 1; index >= 0; index -= 1) {
      const callback = cleanupCallbacks[index]
      if (!callback) {
        continue
      }
      try {
        await callback()
      } catch {
        // Best-effort cleanup; ignore failures.
      }
    }
  }

  const handleSignal = (signal: NodeJS.Signals) => {
    if (handling) {
      if (signal === 'SIGINT') {
        forcedExit = true
        exitFn(130)
      }
      return
    }

    handling = true
    abortController.abort()

    const exitCode = signal === 'SIGTERM' ? 143 : 130
    process.exitCode = exitCode

    void (async () => {
      await runCleanup()
      if (!forcedExit) {
        exitFn(exitCode)
      }
    })()
  }

  const listeners = new Map<NodeJS.Signals, () => void>()

  for (const signal of signalList) {
    const listener = () => handleSignal(signal)
    listeners.set(signal, listener)
    process.on(signal, listener)
  }

  return {
    signal: abortController.signal,
    onCleanup(fn: CleanupFn) {
      cleanupCallbacks.push(fn)
    },
    dispose() {
      for (const [signal, listener] of listeners.entries()) {
        process.off(signal, listener)
      }
    },
  }
}
