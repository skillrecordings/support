/**
 * Editor Integration
 *
 * Opens $EDITOR for editing FAQ answers, waits for save.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { spawn } from 'bun'

/**
 * Open the user's editor with content and return the edited result.
 *
 * @param content - Initial content to edit
 * @param filename - Suggested filename (for syntax highlighting)
 * @returns Edited content or null if cancelled
 */
export async function openEditor(
  content: string,
  filename = 'faq-answer.md'
): Promise<string | null> {
  const editor = process.env.EDITOR || process.env.VISUAL || 'nano'
  const tempDir = join(tmpdir(), 'faq-review')

  // Ensure temp directory exists
  if (!existsSync(tempDir)) {
    mkdirSync(tempDir, { recursive: true })
  }

  const tempFile = join(tempDir, filename)

  // Write content to temp file
  writeFileSync(tempFile, content, 'utf-8')
  const originalContent = content

  try {
    // Open editor and wait for it to close
    const proc = spawn([editor, tempFile], {
      stdio: ['inherit', 'inherit', 'inherit'],
    })

    // Wait for editor to exit
    await proc.exited

    // Read the edited content
    const editedContent = readFileSync(tempFile, 'utf-8')

    // Clean up temp file
    unlinkSync(tempFile)

    // Return null if unchanged (user cancelled)
    if (editedContent.trim() === originalContent.trim()) {
      return null
    }

    return editedContent
  } catch (error) {
    // Clean up on error
    try {
      if (existsSync(tempFile)) {
        unlinkSync(tempFile)
      }
    } catch {
      // Ignore cleanup errors
    }
    throw error
  }
}

/**
 * Create a template for editing a FAQ candidate
 */
export function createEditTemplate(question: string, answer: string): string {
  return `# FAQ Edit

## Question
${question}

## Answer (edit below)
${answer}

---
Save and close to apply changes.
Delete all content to cancel.
`
}

/**
 * Parse edited template back to question/answer
 */
export function parseEditTemplate(content: string): {
  question: string
  answer: string
} | null {
  const trimmed = content.trim()
  if (!trimmed) {
    return null
  }

  // Extract question section
  const questionMatch = trimmed.match(
    /## Question\s*\n([\s\S]*?)(?=\n## Answer|$)/i
  )
  const answerMatch = trimmed.match(/## Answer[^\n]*\n([\s\S]*?)(?=\n---|$)/i)

  if (!questionMatch || !answerMatch) {
    // Fallback: treat the whole thing as the answer if format is broken
    return {
      question: '', // Use original question
      answer: trimmed,
    }
  }

  return {
    question: questionMatch[1].trim(),
    answer: answerMatch[1].trim(),
  }
}
