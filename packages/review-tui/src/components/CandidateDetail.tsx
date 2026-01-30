/**
 * CandidateDetail Component
 *
 * Shows full question/answer for selected candidate.
 */

import type { StoredFaqCandidate } from '../lib/types'

interface CandidateDetailProps {
  candidate: StoredFaqCandidate | null
}

export function CandidateDetail(props: CandidateDetailProps) {
  return (
    <box
      flexDirection="column"
      borderStyle="single"
      borderTop={false}
      paddingX={1}
      paddingY={1}
      flexGrow={1}
    >
      {props.candidate ? (
        <>
          <box flexDirection="column" marginBottom={1}>
            <text bold color="cyan">
              Question:
            </text>
            <text wrap="wrap">{props.candidate.question}</text>
          </box>

          <box flexDirection="column" marginBottom={1}>
            <text bold color="cyan">
              Answer:
            </text>
            <text wrap="wrap">{props.candidate.answer}</text>
          </box>

          <box flexDirection="row" gap={2}>
            <box flexDirection="row">
              <text dimColor>Confidence: </text>
              <text
                color={
                  props.candidate.confidence >= 0.8
                    ? 'green'
                    : props.candidate.confidence >= 0.6
                      ? 'yellow'
                      : 'red'
                }
                bold
              >
                {props.candidate.confidence.toFixed(2)}
              </text>
            </box>
            <text dimColor>│</text>
            <box flexDirection="row">
              <text dimColor>Cluster: </text>
              <text color="cyan">{props.candidate.clusterSize}</text>
            </box>
            <text dimColor>│</text>
            <box flexDirection="row">
              <text dimColor>Sources: </text>
              <text>
                {props.candidate.sourceConversationIds?.length ?? 0} convos
              </text>
            </box>
          </box>

          {props.candidate.tags && props.candidate.tags.length > 0 && (
            <box flexDirection="row" marginTop={1}>
              <text dimColor>Tags: </text>
              <text color="magenta">{props.candidate.tags.join(', ')}</text>
            </box>
          )}

          {props.candidate.suggestedCategory && (
            <box flexDirection="row">
              <text dimColor>Category: </text>
              <text color="blue">{props.candidate.suggestedCategory}</text>
            </box>
          )}
        </>
      ) : (
        <box justifyContent="center" alignItems="center" flexGrow={1}>
          <text dimColor italic>
            No candidate selected
          </text>
        </box>
      )}
    </box>
  )
}
