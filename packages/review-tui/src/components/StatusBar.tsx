/**
 * StatusBar Component
 *
 * Shows app name, queue stats, and status messages.
 */

import { APPS, type ReviewQueueStats } from '../lib/types'

interface StatusBarProps {
  appId: string
  stats: ReviewQueueStats
  statusMessage: string | null
}

export function StatusBar(props: StatusBarProps) {
  const appName = () => {
    const app = APPS.find((a) => a.id === props.appId)
    return app?.name ?? props.appId
  }

  return (
    <box
      flexDirection="row"
      justifyContent="space-between"
      paddingX={1}
      borderStyle="single"
      borderBottom={false}
      borderLeft={false}
      borderRight={false}
    >
      <box flexDirection="row" gap={2}>
        <text bold color="cyan">
          [{appName()}]
        </text>
        <text dimColor>│</text>
        <text color="yellow">{props.stats.pending}</text>
        <text dimColor> pending</text>
        <text dimColor>│</text>
        <text color="green">{props.stats.approved}</text>
        <text dimColor> ✓</text>
        <text dimColor>│</text>
        <text color="red">{props.stats.rejected}</text>
        <text dimColor> ✗</text>
      </box>
      {props.statusMessage && (
        <text color="green" bold>
          {props.statusMessage}
        </text>
      )}
    </box>
  )
}
