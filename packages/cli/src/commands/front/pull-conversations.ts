/**
 * Pull conversations from Front for eval dataset
 * 
 * Usage:
 *   skill front pull --inbox <inbox_id> --limit 100 --output data/front-conversations.json
 */

import { writeFileSync } from 'fs'
import type { Command } from 'commander'

interface PullOptions {
  inbox?: string
  limit?: number
  output?: string
  filter?: string
  json?: boolean
}

interface FrontConversation {
  id: string
  subject: string
  status: string
  created_at: number
  last_message_at?: number
  tags: Array<{ id: string; name: string }>
  recipient?: { handle: string; name?: string }
  assignee?: { email: string }
}

interface FrontMessage {
  id: string
  type: string
  is_inbound: boolean
  created_at: number
  subject?: string
  body?: string
  text?: string
  author?: { email?: string; name?: string }
}

interface EvalSample {
  id: string
  conversationId: string
  subject: string
  customerEmail: string
  status: string
  tags: string[]
  triggerMessage: {
    id: string
    subject: string
    body: string
    timestamp: number
  }
  conversationHistory: Array<{
    direction: 'in' | 'out'
    body: string
    timestamp: number
    author?: string
  }>
  category: string  // inferred from tags/content
}

export async function pullConversations(options: PullOptions): Promise<void> {
  const {
    inbox,
    limit = 50,
    output,
    filter,
    json = false,
  } = options

  const frontToken = process.env.FRONT_API_TOKEN
  if (!frontToken) {
    console.error('Error: FRONT_API_TOKEN environment variable required')
    process.exit(1)
  }

  const headers = {
    'Authorization': `Bearer ${frontToken}`,
    'Content-Type': 'application/json',
  }

  try {
    // If no inbox specified, list available inboxes
    if (!inbox) {
      console.log('Fetching available inboxes...\n')
      const inboxesRes = await fetch('https://api2.frontapp.com/inboxes', { headers })
      const inboxesData = await inboxesRes.json() as { _results: Array<{ id: string; name: string; address?: string }> }
      
      console.log('Available inboxes:')
      for (const ib of inboxesData._results || []) {
        console.log(`  ${ib.id}: ${ib.name} (${ib.address || 'no address'})`)
      }
      console.log('\nUse --inbox <id> to pull conversations from a specific inbox')
      return
    }

    console.log(`Pulling conversations from inbox ${inbox}...`)

    // Get conversations from inbox
    let allConversations: FrontConversation[] = []
    let nextUrl: string | null = `https://api2.frontapp.com/inboxes/${inbox}/conversations?limit=50`
    
    while (nextUrl && allConversations.length < limit) {
      const res = await fetch(nextUrl, { headers })
      const data = await res.json() as { 
        _results: FrontConversation[]
        _pagination?: { next?: string }
      }
      
      allConversations = allConversations.concat(data._results || [])
      nextUrl = data._pagination?.next || null
      
      process.stdout.write(`\r  Fetched ${allConversations.length} conversations...`)
    }

    allConversations = allConversations.slice(0, limit)
    console.log(`\n  Total: ${allConversations.length} conversations`)

    // Filter if specified
    if (filter) {
      const filterLower = filter.toLowerCase()
      allConversations = allConversations.filter(c => {
        const subject = (c.subject || '').toLowerCase()
        const tags = c.tags.map(t => t.name.toLowerCase()).join(' ')
        return subject.includes(filterLower) || tags.includes(filterLower)
      })
      console.log(`  After filter "${filter}": ${allConversations.length} conversations`)
    }

    // Build eval samples
    console.log('\nFetching message details...')
    const samples: EvalSample[] = []
    let processed = 0

    for (const conv of allConversations) {
      processed++
      process.stdout.write(`\r  Processing ${processed}/${allConversations.length}...`)

      try {
        // Get messages for this conversation
        const messagesRes = await fetch(
          `https://api2.frontapp.com/conversations/${conv.id}/messages`,
          { headers }
        )
        const messagesData = await messagesRes.json() as { _results: FrontMessage[] }
        const messages = messagesData._results || []

        // Find the most recent inbound message as trigger
        const inboundMessages = messages
          .filter(m => m.is_inbound)
          .sort((a, b) => b.created_at - a.created_at)

        const triggerMessage = inboundMessages[0]
        if (!triggerMessage) continue  // Skip if no inbound messages

        // Extract body text
        const bodyText = triggerMessage.text || 
          (triggerMessage.body?.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()) || 
          ''

        // Skip very short messages
        if (bodyText.length < 20) continue

        // Build conversation history
        const history = messages
          .sort((a, b) => a.created_at - b.created_at)
          .map(m => ({
            direction: (m.is_inbound ? 'in' : 'out') as 'in' | 'out',
            body: m.text || (m.body?.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()) || '',
            timestamp: m.created_at,
            author: m.author?.email,
          }))

        // Infer category from tags/subject
        const tagNames = conv.tags.map(t => t.name.toLowerCase()).join(' ')
        const subject = (conv.subject || '').toLowerCase()
        let category = 'general'
        
        if (tagNames.includes('refund') || subject.includes('refund')) category = 'refund'
        else if (tagNames.includes('access') || subject.includes('login') || subject.includes('access')) category = 'access'
        else if (tagNames.includes('technical') || subject.includes('error') || subject.includes('bug')) category = 'technical'
        else if (subject.includes('feedback') || subject.includes('suggestion')) category = 'feedback'
        else if (subject.includes('partnership') || subject.includes('collaborate')) category = 'business'

        samples.push({
          id: conv.id,
          conversationId: conv.id,
          subject: conv.subject || '(no subject)',
          customerEmail: conv.recipient?.handle || 'unknown',
          status: conv.status,
          tags: conv.tags.map(t => t.name),
          triggerMessage: {
            id: triggerMessage.id,
            subject: triggerMessage.subject || conv.subject || '',
            body: bodyText,
            timestamp: triggerMessage.created_at,
          },
          conversationHistory: history,
          category,
        })

        // Rate limit
        await new Promise(r => setTimeout(r, 100))
      } catch (err) {
        // Skip failed conversations
        continue
      }
    }

    console.log(`\n\nBuilt ${samples.length} eval samples`)

    // Category breakdown
    const byCategory: Record<string, number> = {}
    for (const s of samples) {
      byCategory[s.category] = (byCategory[s.category] || 0) + 1
    }
    console.log('\nBy category:')
    for (const [cat, count] of Object.entries(byCategory).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${cat}: ${count}`)
    }

    // Output
    if (output) {
      writeFileSync(output, JSON.stringify(samples, null, 2))
      console.log(`\nSaved to ${output}`)
    } else if (json) {
      console.log(JSON.stringify(samples, null, 2))
    }

  } catch (error) {
    console.error('\nError:', error instanceof Error ? error.message : 'Unknown error')
    process.exit(1)
  }
}

export function registerPullCommand(parent: Command): void {
  parent
    .command('pull')
    .description('Pull conversations from Front for eval dataset')
    .option('-i, --inbox <id>', 'Inbox ID to pull from')
    .option('-l, --limit <n>', 'Max conversations to pull', parseInt)
    .option('-o, --output <file>', 'Output file path')
    .option('-f, --filter <term>', 'Filter by subject/tag containing term')
    .option('--json', 'JSON output')
    .action(pullConversations)
}
