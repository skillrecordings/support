#!/usr/bin/env bun
/**
 * Review and properly label production conversations
 * 
 * This manually reviews each conversation and assigns correct labels
 * based on actual content analysis.
 */

import { readFile, writeFile } from 'fs/promises'

interface RawConversation {
  id: string
  app: string
  conversationId: string
  customerEmail: string
  triggerMessage: {
    subject: string
    body: string
    timestamp: number
  }
  agentResponse?: {
    text: string
    category: string
    timestamp: string
  }
  conversationHistory: Array<{
    direction: 'in' | 'out'
    body: string
    timestamp: number
    author?: string
  }>
}

// Manual labels based on actual review
const MANUAL_LABELS: Record<string, {
  category: string
  action?: string
  notes?: string
}> = {
  // === ACCESS ISSUES ===
  'fbdce81a-808f-4221-8242-917b8f367320': { category: 'support_access', notes: 'Cant access after login' },
  '6c4bb6be-a632-4df8-be43-d94eec608c57': { category: 'support_access', notes: '404 on login, multi-turn with teammate' },
  'ae91e693-ec8d-4862-adf7-6b8b99088a06': { category: 'support_access', notes: 'Waiting for workshop materials' },
  'a843e50b-d272-4ce0-a315-afd98ff3954a': { category: 'support_access', notes: 'Cant access after transfer' },
  'e773cbe1-a676-4934-88f4-c9afdafa1408': { category: 'support_access', notes: 'Cant access after transfer (dupe)' },
  
  // === REFUND REQUESTS ===
  'd4ab0d49-65e2-4758-b232-9f487852dddb': { category: 'support_refund', notes: 'Firm doesnt allow claim' },
  '5b3b98fc-7b79-4eea-a2b5-75affd75b3fa': { category: 'support_refund', notes: 'Explicit refund request' },
  'b9c47568-9cf9-4f44-988d-0afb3dc5b856': { category: 'support_refund', notes: 'Impulse purchase refund' },
  
  // === TRANSFER REQUESTS ===
  '3a9ae26a-c33a-4e9c-afb7-0ff397f1b52b': { category: 'support_transfer', notes: 'Move to different email' },
  
  // === BILLING/INVOICE ===
  'c09dde8f-8d1d-4b96-bc15-0a4bd52f39ec': { category: 'support_billing', notes: 'Invoice request' },
  '5ae9e967-8f3b-4b4f-b978-dcf66a71c751': { category: 'support_billing', notes: 'Invoice request for business' },
  
  // === TECHNICAL SUPPORT (actual product questions) ===
  'fc87b6bd-7359-4450-8996-b61e48efaba4': { category: 'support_technical', notes: 'Missing zoom link for workshop' },
  'd6f73028-33fc-4509-88b3-eb7ff378cad1': { category: 'support_technical', notes: 'Buy button not working' },
  'bf8fdabd-4995-431d-afec-abb5f98547ad': { category: 'support_technical', notes: 'Light mode question' },
  'c4f9ab62-ca97-4dc7-8904-e13b0784d7c7': { category: 'support_technical', notes: 'Getting started question' },
  
  // === PRE-SALES / PRICING (treat as support_technical) ===
  'f63a54b3-89c5-4bf3-bb49-662b806c847e': { category: 'support_technical', notes: 'Pricing feedback' },
  '6dd81ba1-bff5-499b-9185-5f14a64d8186': { category: 'support_technical', notes: 'Pricing concern' },
  '69a48933-34d0-4c94-bc8d-204455b11b96': { category: 'support_technical', notes: 'Discount inquiry' },
  
  // === FAN MAIL / APPRECIATION ===
  'ff783555-f7a8-40e0-a7ac-f418f7c2180a': { category: 'fan_mail', notes: 'Appreciation + learning journey' },
  '516e2785-6911-4911-bacd-d1f39289e586': { category: 'fan_mail', notes: 'Binged course, loved it' },
  '9327fd9e-2556-4c8b-af94-8f1a7e0e2af6': { category: 'fan_mail', notes: 'Long-time follower appreciation' },
  
  // === SPAM / VENDOR OUTREACH ===
  '7f4d9d30-49ab-4691-a739-e3db7d50c65d': { category: 'spam', notes: 'Collab request from Volter AI' },
  '120ead92-90b6-401a-b1a7-1dcb0b403b35': { category: 'spam', notes: 'SeaVerse AI partnership pitch' },
  'dff3d45d-22fb-413a-8463-cc6ee7566318': { category: 'spam', notes: 'SEO report spam' },
  '4970d724-5bde-47a6-8b62-fe1504092c54': { category: 'spam', notes: 'YouTube partnership pitch' },
  '68900624-e22e-42d3-9a19-023ac122ff15': { category: 'spam', notes: 'JellyOtter YouTube invite' },
  '34beb268-1ad0-402b-abc2-645cb6046ebf': { category: 'spam', notes: 'AI-Led Growth community pitch' },
  '277eb8e7-c117-40b8-a083-c178e6bbc31d': { category: 'spam', notes: 'Codebuff sponsorship followup' },
  '1b7156d1-e705-43dc-9e4c-532ae29e3fb2': { category: 'spam', notes: 'Pippit AI collab proposal' },
  'a32b737a-c01e-4a2b-b384-989fb3c7a352': { category: 'spam', notes: 'Troll message' },
  
  // === SYSTEM / AUTO ===
  
  // === SURVEY RESPONSES - these are engagement, route to instructor to review ===
  '53fcea14-1411-486c-b6bf-e97bf040e8a4': { category: 'fan_mail', notes: 'Survey response - route to instructor' },
  'dbc4c68d-ba1e-407f-a5e5-bae2fc261074': { category: 'fan_mail', notes: 'Survey response - route to instructor' },
  'aab261ec-5955-4b21-963e-c3c5fcc31b0d': { category: 'fan_mail', notes: 'Survey response - route to instructor' },
  'fffa4b91-2f45-43cd-8df4-88cec04d1f7c': { category: 'fan_mail', notes: 'Survey response - route to instructor' },
  'ec82b4fa-6ca0-4832-9a2d-fbc1523bdf4d': { category: 'fan_mail', notes: 'Survey response - route to instructor' },
  '051e7622-d4f2-466b-b39e-ab12f9c5643d': { category: 'fan_mail', notes: 'Survey response - route to instructor' },
  '8a0e171e-74c8-4988-bfa5-4830c5f2c30f': { category: 'fan_mail', notes: 'Survey response - route to instructor' },
  '05c1fa3c-cf6a-4f3d-9df4-ba2c95a0d9a9': { category: 'fan_mail', notes: 'Survey response - route to instructor' },
  '99a13dd1-43fe-4343-8337-feadd99cc4af': { category: 'fan_mail', notes: 'Survey response - route to instructor' },
  '08c26c7e-7cc6-43c8-88ce-9462c1357770': { category: 'fan_mail', notes: 'Survey response - route to instructor' },
  'e42367e0-5737-47eb-8062-4454481ea491': { category: 'fan_mail', notes: 'Survey response - route to instructor' },
  // Internal strategy discussions
  '736cd845-472a-4650-9873-2f04cccd7e3c': { category: 'instructor_strategy', notes: 'Internal discussion about content' },
  
  // === SUPPORT TECHNICAL - learning/career questions ===
  '0f3b9d92-235e-4c1b-8dc5-832e584bfd48': { category: 'support_technical', notes: 'Learning TS question' },
  '62737986-7116-4c7f-acb7-25d2e45f2ae3': { category: 'support_technical', notes: 'AI confusion question' },
  '9cd38d6b-a59e-4522-9b37-e261a753c286': { category: 'support_technical', notes: 'Career help question' },
  '0c336520-3798-43b3-be0a-62b56fd9952b': { category: 'support_technical', notes: 'Lost with TS - help request' },
  '7599fe27-c24d-4681-aea4-0f556ef1b206': { category: 'support_technical', notes: 'Lost with TS - help request (dupe)' },
  'd6e5cd99-f842-4710-8dc9-41869d6da4e1': { category: 'support_technical', notes: 'Cant figure out TS - help request' },
}

// PII Scrubbing
function scrubPII(text: string): string {
  return text
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi, 'customer@example.com')
    .replace(/\b(Milan|Stojke|Jason|John|Thomas|Leonard|Urban|Kevin|Arvind|Denis|Christian|Fiona)\b/gi, 'Customer')
    .replace(/girardier\.thomas/gi, 'customer1')
    .replace(/LI YUEN TAT/gi, 'Customer')
}

async function main() {
  const raw = await readFile('fixtures/datasets/comprehensive-dataset.json', 'utf-8')
  const conversations: RawConversation[] = JSON.parse(raw)
  
  console.log(`Reviewing ${conversations.length} conversations...\n`)
  
  const scenarios: any[] = []
  const unlabeled: string[] = []
  const categoryCount: Record<string, number> = {}
  
  for (const conv of conversations) {
    const label = MANUAL_LABELS[conv.id]
    
    if (!label) {
      unlabeled.push(conv.id)
      // Show for manual review
      console.log(`\n=== UNLABELED: ${conv.id.slice(0, 8)} ===`)
      console.log(`Subject: ${conv.triggerMessage.subject.slice(0, 60)}`)
      console.log(`Body: ${conv.triggerMessage.body.slice(0, 150)}...`)
      continue
    }
    
    // Build thread (up to trigger message)
    const history = [...conv.conversationHistory].reverse()
    let lastInboundIdx = -1
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].direction === 'in') {
        lastInboundIdx = i
        break
      }
    }
    
    const messages = (lastInboundIdx >= 0 ? history.slice(0, lastInboundIdx + 1) : history)
      .map(msg => ({
        direction: msg.direction,
        body: scrubPII(msg.body),
        timestamp: msg.timestamp,
        subject: msg.direction === 'in' ? scrubPII(conv.triggerMessage.subject) : undefined,
      }))
    
    if (messages.length === 0) continue
    
    const trigger = messages[messages.length - 1]
    
    scenarios.push({
      id: `prod_${conv.id.slice(0, 8)}`,
      name: `${label.category}: ${scrubPII(conv.triggerMessage.subject).slice(0, 50)}`,
      notes: label.notes,
      input: {
        conversationId: conv.conversationId,
        appId: conv.app || 'unknown',
        messages,
        triggerMessage: trigger,
      },
      expected: {
        category: label.category,
        action: label.action,
      },
      tags: [
        label.category,
        messages.length === 1 ? 'single' : 'multi_turn',
      ],
    })
    
    categoryCount[label.category] = (categoryCount[label.category] || 0) + 1
  }
  
  console.log(`\n\n=== SUMMARY ===`)
  console.log(`Labeled: ${scenarios.length}`)
  console.log(`Unlabeled: ${unlabeled.length}`)
  
  console.log('\nBy category:')
  for (const [cat, count] of Object.entries(categoryCount).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${cat}: ${count}`)
  }
  
  if (unlabeled.length > 0) {
    console.log('\n⚠️  Add labels for these IDs in MANUAL_LABELS:')
    for (const id of unlabeled) {
      console.log(`  '${id}': { category: '???', notes: '' },`)
    }
  }
  
  // Write labeled scenarios
  await writeFile(
    'fixtures/datasets/thread-scenarios-labeled.json',
    JSON.stringify(scenarios, null, 2)
  )
  console.log(`\nSaved ${scenarios.length} scenarios to fixtures/datasets/thread-scenarios-labeled.json`)
}

main().catch(console.error)
