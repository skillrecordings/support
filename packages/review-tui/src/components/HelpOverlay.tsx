/**
 * HelpOverlay Component
 *
 * Shows keybindings help when ? is pressed.
 */

import { For } from 'solid-js'

interface HelpOverlayProps {
  visible: boolean
}

export function HelpOverlay(props: HelpOverlayProps) {
  if (!props.visible) return null

  const keybindings = [
    ['j / ↓', 'Next candidate'],
    ['k / ↑', 'Previous candidate'],
    ['a', 'Approve candidate'],
    ['e', 'Edit in $EDITOR'],
    ['r', 'Reject candidate'],
    ['s', 'Skip (next without action)'],
    ['1-6', 'Switch app'],
    ['?', 'Toggle this help'],
    ['q', 'Quit'],
  ]

  return (
    <box
      position="absolute"
      flexDirection="column"
      borderStyle="double"
      borderColor="cyan"
      paddingX={2}
      paddingY={1}
      marginLeft={10}
      marginTop={5}
    >
      <text bold color="cyan" underline>
        Keybindings
      </text>
      <box marginTop={1} flexDirection="column">
        <For each={keybindings}>
          {([key, desc]) => (
            <box flexDirection="row" gap={2}>
              <text color="yellow" bold>
                {(key as string).padEnd(8)}
              </text>
              <text>{desc}</text>
            </box>
          )}
        </For>
      </box>
      <box marginTop={1}>
        <text dimColor italic>
          Press ? to close
        </text>
      </box>
    </box>
  )
}
