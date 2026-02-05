/**
 * Simple CLI spinner for loading states.
 * Only shows in TTY mode, suppressed for JSON output or piped commands.
 */

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const INTERVAL = 80

export interface Spinner {
  start: (message?: string) => void
  update: (message: string) => void
  stop: () => void
  succeed: (message?: string) => void
  fail: (message?: string) => void
}

/**
 * Create a spinner that only shows in interactive mode.
 */
export function createSpinner(): Spinner {
  const isTTY = process.stderr.isTTY && !process.env.CI
  let interval: ReturnType<typeof setInterval> | null = null
  let frameIndex = 0
  let currentMessage = ''

  const clear = () => {
    if (!isTTY) return
    process.stderr.write('\r\x1b[K') // Clear line
  }

  const render = () => {
    if (!isTTY) return
    const frame = FRAMES[frameIndex]
    process.stderr.write(`\r${frame} ${currentMessage}`)
    frameIndex = (frameIndex + 1) % FRAMES.length
  }

  const start = (message = 'Loading...') => {
    if (!isTTY) return
    currentMessage = message
    frameIndex = 0
    render()
    interval = setInterval(render, INTERVAL)
  }

  const update = (message: string) => {
    currentMessage = message
    if (isTTY && !interval) {
      render()
    }
  }

  const stop = () => {
    if (interval) {
      clearInterval(interval)
      interval = null
    }
    clear()
  }

  const succeed = (message?: string) => {
    stop()
    if (isTTY && message) {
      process.stderr.write(`✓ ${message}\n`)
    }
  }

  const fail = (message?: string) => {
    stop()
    if (isTTY && message) {
      process.stderr.write(`✗ ${message}\n`)
    }
  }

  return { start, update, stop, succeed, fail }
}

/**
 * Wrap an async function with a spinner.
 * Shows spinner during execution, clears on completion.
 */
export async function withSpinner<T>(
  message: string,
  fn: () => Promise<T>
): Promise<T> {
  const spinner = createSpinner()
  spinner.start(message)
  try {
    const result = await fn()
    spinner.stop()
    return result
  } catch (error) {
    spinner.stop()
    throw error
  }
}
