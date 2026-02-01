import { marked } from 'marked'

// Configure marked for email-safe output.
marked.setOptions({
  gfm: true,
  breaks: true,
})

export function markdownToHtml(text: string): string {
  return marked.parse(text) as string
}
