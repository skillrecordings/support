/**
 * CandidateList Component
 *
 * Scrollable list of FAQ candidates with selection indicator.
 */

import { For } from 'solid-js'
import type { StoredFaqCandidate } from '../lib/types'

interface CandidateListProps {
  candidates: StoredFaqCandidate[]
  selectedIndex: number
  maxVisible?: number
}

export function CandidateList(props: CandidateListProps) {
  const maxVisible = () => props.maxVisible ?? 8

  // Calculate visible window
  const visibleRange = () => {
    const total = props.candidates.length
    const max = maxVisible()
    const selected = props.selectedIndex

    if (total <= max) {
      return { start: 0, end: total }
    }

    // Keep selected item roughly centered
    let start = Math.max(0, selected - Math.floor(max / 2))
    const end = Math.min(total, start + max)

    // Adjust if we're at the end
    if (end === total) {
      start = Math.max(0, total - max)
    }

    return { start, end }
  }

  const visibleCandidates = () => {
    const { start, end } = visibleRange()
    return props.candidates.slice(start, end).map((c, i) => ({
      candidate: c,
      actualIndex: start + i,
    }))
  }

  const truncateQuestion = (q: string, maxLen = 45) => {
    if (q.length <= maxLen) return q.padEnd(maxLen)
    return q.slice(0, maxLen - 3) + '...'
  }

  return (
    <box flexDirection="column" borderStyle="single" borderTop={false}>
      <For each={visibleCandidates()}>
        {({ candidate, actualIndex }) => {
          const isSelected = actualIndex === props.selectedIndex
          return (
            <box
              flexDirection="row"
              paddingX={1}
              backgroundColor={isSelected ? 'blue' : undefined}
            >
              <text color={isSelected ? 'white' : 'gray'}>
                {isSelected ? '▸ ' : '  '}
              </text>
              <text color={isSelected ? 'white' : undefined} bold={isSelected}>
                {truncateQuestion(candidate.question)}
              </text>
              <box flexGrow={1} />
              <text color="yellow" dimColor={!isSelected}>
                [{candidate.confidence.toFixed(2)}]
              </text>
              <text dimColor> cluster:</text>
              <text color="cyan" dimColor={!isSelected}>
                {candidate.clusterSize}
              </text>
            </box>
          )
        }}
      </For>
      {props.candidates.length === 0 && (
        <box paddingX={2} paddingY={1}>
          <text dimColor italic>
            No pending candidates. Press 1-9 to switch apps.
          </text>
        </box>
      )}
      {props.candidates.length > maxVisible() && (
        <box paddingX={1}>
          <text dimColor>
            ↑↓ {props.candidates.length - maxVisible()} more...
          </text>
        </box>
      )}
    </box>
  )
}
