/**
 * Main App Component
 *
 * Orchestrates the TUI layout and keyboard handling.
 */

import { useKeyboard } from '@opentui/solid'
import {
  approveCandidate,
  getPendingCandidates,
  getQueueStats,
  rejectCandidate,
} from '@skillrecordings/core/faq/review'
import { Show, createEffect, createSignal, onMount } from 'solid-js'

import {
  createEditTemplate,
  openEditor,
  parseEditTemplate,
} from '../lib/editor'
import {
  APPS,
  type ReviewQueueStats,
  type StoredFaqCandidate,
} from '../lib/types'
import { CandidateDetail } from './CandidateDetail'
import { CandidateList } from './CandidateList'
import { HelpOverlay } from './HelpOverlay'
import { StatusBar } from './StatusBar'

export function App() {
  // State
  const [appId, setAppId] = createSignal(APPS[0].id)
  const [candidates, setCandidates] = createSignal<StoredFaqCandidate[]>([])
  const [selectedIndex, setSelectedIndex] = createSignal(0)
  const [stats, setStats] = createSignal<ReviewQueueStats>({
    pending: 0,
    approved: 0,
    rejected: 0,
    total: 0,
  })
  const [loading, setLoading] = createSignal(true)
  const [error, setError] = createSignal<string | null>(null)
  const [showHelp, setShowHelp] = createSignal(false)
  const [statusMessage, setStatusMessage] = createSignal<string | null>(null)

  const selectedCandidate = () => candidates()[selectedIndex()] ?? null

  // Clear status message after delay
  const flashStatus = (msg: string) => {
    setStatusMessage(msg)
    setTimeout(() => setStatusMessage(null), 2000)
  }

  // Load candidates for current app
  const loadCandidates = async () => {
    setLoading(true)
    setError(null)
    try {
      const [fetchedCandidates, fetchedStats] = await Promise.all([
        getPendingCandidates(appId(), 100),
        getQueueStats(appId()),
      ])
      setCandidates(fetchedCandidates)
      setStats(fetchedStats)
      setSelectedIndex(0)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load candidates')
    } finally {
      setLoading(false)
    }
  }

  // Load on mount and when app changes
  onMount(() => loadCandidates())
  createEffect(() => {
    appId() // Track dependency
    loadCandidates()
  })

  // Remove candidate from list locally
  const removeCandidate = (id: string) => {
    setCandidates((prev) => prev.filter((c) => c.id !== id))
    // Adjust selection if needed
    if (selectedIndex() >= candidates().length) {
      setSelectedIndex(Math.max(0, candidates().length - 1))
    }
    // Update stats
    setStats((prev) => ({
      ...prev,
      pending: prev.pending - 1,
    }))
  }

  // Handle keyboard input
  useKeyboard(async (key) => {
    const input = key.key

    // Help toggle
    if (input === '?') {
      setShowHelp((prev) => !prev)
      return
    }

    // Close help on any key if open
    if (showHelp()) {
      setShowHelp(false)
      return
    }

    // Quit
    if (input === 'q') {
      process.exit(0)
    }

    // Navigation
    if (input === 'j' || input === 'down') {
      setSelectedIndex((i) => Math.min(i + 1, candidates().length - 1))
      return
    }

    if (input === 'k' || input === 'up') {
      setSelectedIndex((i) => Math.max(i - 1, 0))
      return
    }

    // App switching (1-9)
    const numKey = parseInt(input, 10)
    if (numKey >= 1 && numKey <= 9) {
      const app = APPS.find((a) => a.key === input)
      if (app) {
        setAppId(app.id)
        flashStatus(`Switched to ${app.name}`)
      }
      return
    }

    // Skip
    if (input === 's') {
      setSelectedIndex((i) => Math.min(i + 1, candidates().length - 1))
      flashStatus('Skipped')
      return
    }

    const candidate = selectedCandidate()
    if (!candidate) return

    // Approve
    if (input === 'a') {
      setLoading(true)
      try {
        const result = await approveCandidate(candidate.id)
        if (result.success) {
          removeCandidate(candidate.id)
          setStats((prev) => ({ ...prev, approved: prev.approved + 1 }))
          flashStatus('✓ Approved!')
        } else {
          setError(result.error ?? 'Failed to approve')
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to approve')
      } finally {
        setLoading(false)
      }
      return
    }

    // Reject
    if (input === 'r') {
      setLoading(true)
      try {
        const result = await rejectCandidate(candidate.id)
        if (result.success) {
          removeCandidate(candidate.id)
          setStats((prev) => ({ ...prev, rejected: prev.rejected + 1 }))
          flashStatus('✗ Rejected')
        } else {
          setError(result.error ?? 'Failed to reject')
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to reject')
      } finally {
        setLoading(false)
      }
      return
    }

    // Edit
    if (input === 'e') {
      setStatusMessage('Opening editor...')
      try {
        const template = createEditTemplate(
          candidate.question,
          candidate.answer
        )
        const edited = await openEditor(template, `faq-${candidate.id}.md`)

        if (edited) {
          const parsed = parseEditTemplate(edited)
          if (parsed && parsed.answer) {
            setLoading(true)
            const result = await approveCandidate(candidate.id, {
              question: parsed.question || candidate.question,
              answer: parsed.answer,
              editNotes: 'Edited via TUI',
            })
            if (result.success) {
              removeCandidate(candidate.id)
              setStats((prev) => ({ ...prev, approved: prev.approved + 1 }))
              flashStatus('✓ Approved with edits!')
            } else {
              setError(result.error ?? 'Failed to approve')
            }
            setLoading(false)
          } else {
            flashStatus('Edit cancelled (empty content)')
          }
        } else {
          flashStatus('Edit cancelled (no changes)')
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Editor failed')
      }
      setStatusMessage(null)
      return
    }
  })

  return (
    <box flexDirection="column" width="100%" height="100%">
      {/* Header */}
      <box
        borderStyle="double"
        borderColor="cyan"
        borderBottom={false}
        paddingX={1}
      >
        <text bold color="cyan">
          FAQ Review
        </text>
      </box>

      {/* Status Bar */}
      <StatusBar
        appId={appId()}
        stats={stats()}
        statusMessage={statusMessage()}
      />

      {/* Error Display */}
      <Show when={error()}>
        <box paddingX={1} backgroundColor="red">
          <text color="white" bold>
            Error: {error()}
          </text>
        </box>
      </Show>

      {/* Loading */}
      <Show when={loading()}>
        <box paddingX={1}>
          <text color="yellow">Loading...</text>
        </box>
      </Show>

      {/* Main Content */}
      <Show when={!loading()}>
        <CandidateList
          candidates={candidates()}
          selectedIndex={selectedIndex()}
          maxVisible={8}
        />
        <CandidateDetail candidate={selectedCandidate()} />
      </Show>

      {/* Footer Keybindings */}
      <box
        borderStyle="single"
        borderTop={false}
        paddingX={1}
        flexDirection="row"
        gap={1}
      >
        <text color="green">[a]</text>
        <text dimColor>pprove</text>
        <text color="yellow">[e]</text>
        <text dimColor>dit</text>
        <text color="red">[r]</text>
        <text dimColor>eject</text>
        <text color="blue">[s]</text>
        <text dimColor>kip</text>
        <text dimColor>[j/k]nav</text>
        <text dimColor>[?]help</text>
        <text dimColor>[q]uit</text>
      </box>

      {/* Help Overlay */}
      <HelpOverlay visible={showHelp()} />
    </box>
  )
}
