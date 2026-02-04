import { Axiom } from '@axiomhq/js'

export function getDataset(): string {
  return process.env.AXIOM_DATASET || 'support-agent'
}

export function getAxiomClient(): Axiom {
  const token = process.env.AXIOM_TOKEN
  if (!token) {
    console.error('AXIOM_TOKEN environment variable is required')
    process.exit(1)
  }
  return new Axiom({ token })
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${(ms / 60000).toFixed(1)}m`
}

export function formatTime(timestamp: string | Date): string {
  const date = new Date(timestamp)
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export function parseTimeRange(since: string): {
  startTime: Date
  endTime: Date
} {
  const endTime = new Date()
  let startTime: Date

  const match = since.match(/^(\d+)([hmd])$/)
  if (match && match[1] && match[2]) {
    const value = parseInt(match[1], 10)
    const unit = match[2] as 'h' | 'm' | 'd'
    const msPerUnit: Record<'h' | 'm' | 'd', number> = {
      h: 60 * 60 * 1000,
      m: 60 * 1000,
      d: 24 * 60 * 60 * 1000,
    }
    startTime = new Date(endTime.getTime() - value * msPerUnit[unit])
  } else {
    startTime = new Date(since)
    if (isNaN(startTime.getTime())) {
      console.error(
        `Invalid time range: ${since}. Use format like "1h", "24h", "7d" or ISO date.`
      )
      process.exit(1)
    }
  }

  return { startTime, endTime }
}
