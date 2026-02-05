import { Axiom } from '@axiomhq/js'

export interface TelemetryEvent {
  command: string
  duration: number
  success: boolean
  platform: string
  user?: string
}

const DEFAULT_DATASET = 'support-agent'

let axiomClient: Axiom | null = null

function isTelemetryDisabled(): boolean {
  return process.env.SKILL_NO_TELEMETRY === '1'
}

function getAxiomClient(): Axiom | null {
  const token = process.env.AXIOM_TOKEN
  if (!token) return null
  if (!axiomClient) {
    axiomClient = new Axiom({ token })
  }
  return axiomClient
}

export function resolveTelemetryUser(): string | undefined {
  const raw =
    process.env.USER ?? process.env.LOGNAME ?? process.env.USERNAME ?? ''
  const trimmed = raw.trim()
  if (!trimmed) return undefined
  const base = trimmed.split('@')[0]?.trim()
  return base || undefined
}

export async function sendTelemetryEvent(event: TelemetryEvent): Promise<void> {
  if (isTelemetryDisabled()) return

  const client = getAxiomClient()
  if (!client) return

  const dataset = process.env.AXIOM_DATASET || DEFAULT_DATASET
  const safeEvent: TelemetryEvent = {
    command: event.command,
    duration: event.duration,
    success: event.success,
    platform: event.platform,
    user: event.user,
  }

  try {
    await client.ingest(dataset, {
      _time: new Date().toISOString(),
      ...safeEvent,
    })
  } catch {
    // Telemetry should never block or crash the CLI.
  }
}
