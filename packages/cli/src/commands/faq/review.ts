/**
 * FAQ Review CLI Command
 *
 * Interactive CLI for human curation of FAQ candidates.
 * Approve, edit, reject, or skip candidates before publishing to KB.
 *
 * Usage:
 *   skill faq review --app total-typescript
 *   skill faq review --app epic-react --stats
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { confirm, select } from '@inquirer/prompts'
import {
  type StoredFaqCandidate,
  approveCandidate,
  getPendingCandidates,
  getQueueStats,
  rejectCandidate,
} from '@skillrecordings/core/faq/review'
import type { Command } from 'commander'

/**
 * Color codes for terminal output
 */
const COLORS = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
} as const

/**
 * Word wrap text to specified width
 */
function wordWrap(text: string, width: number): string {
  const words = text.split(' ')
  const lines: string[] = []
  let currentLine = ''

  for (const word of words) {
    if (currentLine.length + word.length + 1 <= width) {
      currentLine += (currentLine ? ' ' : '') + word
    } else {
      if (currentLine) lines.push(currentLine)
      currentLine = word
    }
  }

  if (currentLine) lines.push(currentLine)
  return lines.join('\n')
}

/**
 * Display a single FAQ candidate
 */
function displayCandidate(
  candidate: StoredFaqCandidate,
  index: number,
  total: number
): void {
  console.log('\n' + '═'.repeat(70))
  console.log(
    `${COLORS.bold}FAQ Candidate ${index + 1} of ${total}${COLORS.reset}`
  )
  console.log('═'.repeat(70))

  // Metadata row
  const confPct = (candidate.confidence * 100).toFixed(0)
  const unchangedPct = (candidate.unchangedRate * 100).toFixed(0)
  console.log(
    `${COLORS.dim}Confidence: ${confPct}% | Cluster: ${candidate.clusterSize} convos | Unchanged: ${unchangedPct}%${COLORS.reset}`
  )

  if (candidate.suggestedCategory) {
    console.log(
      `${COLORS.dim}Category: ${candidate.suggestedCategory}${COLORS.reset}`
    )
  }

  if (candidate.tags.length > 0) {
    console.log(
      `${COLORS.dim}Tags: ${candidate.tags.slice(0, 5).join(', ')}${COLORS.reset}`
    )
  }

  // Question
  console.log(`\n${COLORS.bold}${COLORS.cyan}Question:${COLORS.reset}`)
  console.log(wordWrap(candidate.question, 68))

  // Answer
  console.log(`\n${COLORS.bold}${COLORS.green}Answer:${COLORS.reset}`)
  console.log(wordWrap(candidate.answer, 68))

  console.log('\n' + '-'.repeat(70))
}

/**
 * Get editor command
 */
function getEditor(): string {
  return process.env.EDITOR || process.env.VISUAL || 'nano'
}

/**
 * Open content in editor and return edited content
 */
function editInEditor(
  question: string,
  answer: string
): { question: string; answer: string } | null {
  const editor = getEditor()
  const tmpFile = join(tmpdir(), `faq-edit-${Date.now()}.md`)

  // Write content to temp file
  const content = `# FAQ Edit

## Question
${question}

## Answer
${answer}

<!-- 
Edit the question and answer above.
Save and close the editor when done.
The sections are separated by "## Question" and "## Answer" headers.
-->
`

  writeFileSync(tmpFile, content, 'utf-8')

  try {
    // Open editor (blocking)
    const result = spawnSync(editor, [tmpFile], {
      stdio: 'inherit',
      shell: true,
    })

    if (result.status !== 0) {
      console.log(`${COLORS.red}Editor exited with error${COLORS.reset}`)
      return null
    }

    // Read edited content
    const edited = readFileSync(tmpFile, 'utf-8')

    // Parse sections
    const questionMatch = edited.match(
      /## Question\s*\n([\s\S]*?)(?=\n## Answer|$)/
    )
    const answerMatch = edited.match(/## Answer\s*\n([\s\S]*?)(?=\n<!--|$)/)

    const editedQuestion = questionMatch?.[1]?.trim()
    const editedAnswer = answerMatch?.[1]?.trim()

    if (!editedQuestion || !editedAnswer) {
      console.log(
        `${COLORS.red}Could not parse edited content. Please keep the ## headers.${COLORS.reset}`
      )
      return null
    }

    return {
      question: editedQuestion,
      answer: editedAnswer,
    }
  } finally {
    // Clean up temp file
    if (existsSync(tmpFile)) {
      unlinkSync(tmpFile)
    }
  }
}

/**
 * Run interactive review session
 */
async function runReviewSession(options: {
  app: string
}): Promise<void> {
  console.log(`\n${COLORS.bold}📋 FAQ Review Session${COLORS.reset}`)
  console.log(`App: ${options.app}`)
  console.log('Loading candidates...\n')

  // Load pending candidates
  const candidates = await getPendingCandidates(options.app, 100)

  if (candidates.length === 0) {
    console.log(
      `${COLORS.yellow}No pending FAQ candidates found.${COLORS.reset}`
    )
    console.log(
      `Run ${COLORS.cyan}skill faq mine --app ${options.app} --since 30d${COLORS.reset} to generate candidates.`
    )
    return
  }

  console.log(
    `Found ${COLORS.bold}${candidates.length}${COLORS.reset} pending candidates.`
  )

  // Session stats
  let approved = 0
  let rejected = 0
  let skipped = 0
  let edited = 0

  // Review loop
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i]!

    displayCandidate(candidate, i, candidates.length)

    // Get action
    const action = await select({
      message: 'Action:',
      choices: [
        {
          name: `${COLORS.green}[A]pprove${COLORS.reset} - Publish to KB`,
          value: 'approve',
        },
        {
          name: `${COLORS.blue}[E]dit${COLORS.reset} - Edit then publish`,
          value: 'edit',
        },
        {
          name: `${COLORS.red}[R]eject${COLORS.reset} - Won't resurface`,
          value: 'reject',
        },
        {
          name: `${COLORS.dim}[S]kip${COLORS.reset} - Review later`,
          value: 'skip',
        },
        {
          name: `${COLORS.dim}[Q]uit${COLORS.reset} - End session`,
          value: 'quit',
        },
      ],
    })

    if (action === 'quit') {
      break
    }

    if (action === 'skip') {
      skipped++
      console.log(`${COLORS.dim}⏭ Skipped${COLORS.reset}`)
      continue
    }

    if (action === 'reject') {
      const result = await rejectCandidate(
        candidate.id,
        'Rejected via CLI review'
      )
      if (result.success) {
        rejected++
        console.log(`${COLORS.red}✗ Rejected - won't resurface${COLORS.reset}`)
      } else {
        console.log(
          `${COLORS.red}✗ Failed to reject: ${result.error}${COLORS.reset}`
        )
      }
      continue
    }

    // approve or edit
    let finalQuestion = candidate.question
    let finalAnswer = candidate.answer
    let wasEdited = false

    if (action === 'edit') {
      console.log(`\nOpening ${getEditor()}...`)
      const editResult = editInEditor(candidate.question, candidate.answer)

      if (!editResult) {
        console.log('Edit cancelled. Skipping candidate.')
        skipped++
        continue
      }

      finalQuestion = editResult.question
      finalAnswer = editResult.answer
      wasEdited =
        finalQuestion !== candidate.question || finalAnswer !== candidate.answer

      if (wasEdited) {
        console.log(`\n${COLORS.yellow}Content was edited.${COLORS.reset}`)
        console.log(`\n${COLORS.bold}New Question:${COLORS.reset}`)
        console.log(wordWrap(finalQuestion, 68))
        console.log(`\n${COLORS.bold}New Answer:${COLORS.reset}`)
        console.log(wordWrap(finalAnswer, 68))

        const confirmPublish = await confirm({
          message: 'Publish edited FAQ?',
          default: true,
        })

        if (!confirmPublish) {
          skipped++
          continue
        }
      }
    }

    // Publish (approve or edit)
    const result = await approveCandidate(candidate.id, {
      question: wasEdited ? finalQuestion : undefined,
      answer: wasEdited ? finalAnswer : undefined,
      editNotes: wasEdited ? 'Edited during CLI review' : undefined,
    })

    if (result.success) {
      approved++
      if (wasEdited) edited++
      console.log(
        `${COLORS.green}✓ Published as ${result.articleId}${COLORS.reset}`
      )
    } else {
      console.log(
        `${COLORS.red}✗ Failed to publish: ${result.error}${COLORS.reset}`
      )
    }
  }

  // Session summary
  console.log('\n' + '═'.repeat(70))
  console.log(`${COLORS.bold}📊 Session Summary${COLORS.reset}`)
  console.log('═'.repeat(70))
  console.log(
    `${COLORS.green}Approved: ${approved}${edited > 0 ? ` (${edited} edited)` : ''}${COLORS.reset}`
  )
  console.log(`${COLORS.red}Rejected: ${rejected}${COLORS.reset}`)
  console.log(`${COLORS.dim}Skipped: ${skipped}${COLORS.reset}`)
  console.log('')
}

/**
 * Display review statistics
 */
async function showStats(appId: string, json: boolean): Promise<void> {
  const stats = await getQueueStats(appId)

  if (json) {
    console.log(JSON.stringify(stats, null, 2))
    return
  }

  console.log(
    `\n${COLORS.bold}📊 Review Queue Statistics for ${appId}${COLORS.reset}`
  )
  console.log('─'.repeat(40))
  console.log(`Pending:          ${stats.pending}`)
  console.log(
    `${COLORS.green}Approved:         ${stats.approved}${COLORS.reset}`
  )
  console.log(`${COLORS.red}Rejected:         ${stats.rejected}${COLORS.reset}`)
  console.log(`Total:            ${stats.total}`)

  if (stats.total > 0 && stats.approved + stats.rejected > 0) {
    const approvalRate = (
      (stats.approved / (stats.approved + stats.rejected)) *
      100
    ).toFixed(1)
    console.log(`\nApproval rate:    ${approvalRate}%`)
  }

  console.log('')
}

/**
 * Main command handler
 */
async function faqReview(options: {
  app: string
  stats?: boolean
  json?: boolean
}): Promise<void> {
  if (!options.app) {
    console.error('Error: --app is required')
    process.exit(1)
  }

  try {
    if (options.stats) {
      await showStats(options.app, options.json ?? false)
    } else {
      await runReviewSession({
        app: options.app,
      })
    }
  } catch (error) {
    if ((error as any)?.name === 'ExitPromptError') {
      // User pressed Ctrl+C
      console.log('\n\nReview session cancelled.')
      process.exit(0)
    }

    console.error(
      'Error:',
      error instanceof Error ? error.message : String(error)
    )
    process.exit(1)
  }
}

/**
 * Register FAQ review commands with Commander
 */
export function registerFaqReviewCommands(program: Command): void {
  program
    .command('review')
    .description('Interactive review of FAQ candidates')
    .requiredOption('-a, --app <slug>', 'App slug to review (required)')
    .option('--stats', 'Show review statistics instead of interactive review')
    .option('--json', 'Output stats as JSON (use with --stats)')
    .action(faqReview)
}
