#!/usr/bin/env bun
/**
 * Build REAL thread dataset with honest labels
 */

import { readFile, writeFile } from 'fs/promises'

// Honest manual labels based on actually reading each conversation
const LABELS: Record<string, { cat: string; action: string; notes: string }> = {
  // SUPPORT ACCESS - can't get to their stuff
  'fbdce81a': { cat: 'support_access', action: 'respond', notes: 'Bought course, cant access after GitHub login' },
  '6c4bb6be': { cat: 'support_access', action: 'respond', notes: '404 on login, multi-turn with Haze' },
  'a843e50b': { cat: 'support_access', action: 'respond', notes: 'Cant access after attempted transfer' },
  'e773cbe1': { cat: 'support_access', action: 'respond', notes: 'Duplicate of above' },
  'ae91e693': { cat: 'support_access', action: 'respond', notes: 'Waiting for workshop materials email' },
  
  // SUPPORT REFUND - want money back
  'd4ab0d49': { cat: 'support_refund', action: 'respond', notes: 'Company didnt approve, needs refund' },
  'b9c47568': { cat: 'support_refund', action: 'respond', notes: 'Impulse purchase regret' },
  
  // SUPPORT BILLING - invoice/receipt
  '5ae9e967': { cat: 'support_billing', action: 'respond', notes: 'Business invoice request' },
  
  // SUPPORT TECHNICAL - actual product/tech questions
  'fc87b6bd': { cat: 'support_technical', action: 'respond', notes: 'No Zoom link for workshop' },
  'd6f73028': { cat: 'support_technical', action: 'respond', notes: 'Buy button broken' },
  'c4f9ab62': { cat: 'support_technical', action: 'respond', notes: 'Module system issue in lesson' },
  'bf8fdabd': { cat: 'support_technical', action: 'respond', notes: 'Does course have light mode?' },
  'ff783555': { cat: 'support_technical', action: 'respond', notes: 'Struggling with generics' },
  '0f3b9d92': { cat: 'support_technical', action: 'respond', notes: 'Where to start learning TS' },
  '[PHONE]': { cat: 'support_technical', action: 'respond', notes: 'AI confusing, where to start' },
  
  // PRE-SALES - pricing, discounts (respond with info)
  'f63a54b3': { cat: 'support_technical', action: 'respond', notes: 'Pricing feedback - too expensive' },
  '6dd81ba1': { cat: 'support_technical', action: 'respond', notes: 'Pricing concern + recording question' },
  '69a48933': { cat: 'support_technical', action: 'respond', notes: 'Asking about discounts' },
  
  // FAN MAIL - genuine appreciation, route to instructor
  '516e2785': { cat: 'fan_mail', action: 'escalate_instructor', notes: 'Binged course, loved it' },
  '9327fd9e': { cat: 'fan_mail', action: 'escalate_instructor', notes: 'Following since early days, appreciation' },
  
  // SURVEY RESPONSES - replies to "A quick question..." 
  // These are engagement, route to instructor
  '53fcea14': { cat: 'fan_mail', action: 'escalate_instructor', notes: 'Survey: FOMO about AI techniques' },
  'dbc4c68d': { cat: 'fan_mail', action: 'escalate_instructor', notes: 'Survey: Know nothing about TS' },
  'aab261ec': { cat: 'fan_mail', action: 'escalate_instructor', notes: 'Survey: AI accuracy interest' },
  'fffa4b91': { cat: 'fan_mail', action: 'escalate_instructor', notes: 'Survey: Agentic coding journey' },
  'ec82b4fa': { cat: 'fan_mail', action: 'escalate_instructor', notes: 'Survey: Found helpful articles' },
  '051e7622': { cat: 'fan_mail', action: 'escalate_instructor', notes: 'Survey: Everything about AI' },
  '8a0e171e': { cat: 'fan_mail', action: 'escalate_instructor', notes: 'Survey: Eng manager AI approach' },
  '05c1fa3c': { cat: 'fan_mail', action: 'escalate_instructor', notes: 'Survey: QA/Playwright background' },
  '99a13dd1': { cat: 'fan_mail', action: 'escalate_instructor', notes: 'Survey: Getting behind on AI' },
  '08c26c7e': { cat: 'fan_mail', action: 'escalate_instructor', notes: 'Survey: AI and Types interest' },
  'e42367e0': { cat: 'fan_mail', action: 'escalate_instructor', notes: 'Survey: Frontend dev intro' },
  
  // SPAM - vendor outreach, partnerships
  '7f4d9d30': { cat: 'spam', action: 'silence', notes: 'Volter AI collab pitch' },
  '4970d724': { cat: 'spam', action: 'silence', notes: 'YouTube partnership pitch' },
  '[PHONE]': { cat: 'spam', action: 'silence', notes: 'JellyOtter YouTube invite' },
  '34beb268': { cat: 'spam', action: 'silence', notes: 'AI-Led Growth community pitch' },
  '277eb8e7': { cat: 'spam', action: 'silence', notes: 'Codebuff sponsorship followup' },
  'dff3d45d': { cat: 'spam', action: 'silence', notes: 'SEO report spam' },
  '1b7156d1': { cat: 'spam', action: 'silence', notes: 'Pippit AI collab' },
  '120ead92': { cat: 'spam', action: 'silence', notes: 'SeaVerse AI pitch' },
  'a32b737a': { cat: 'spam', action: 'silence', notes: 'Troll message - eat my shorts' },
  
  // INTERNAL / INSTRUCTOR STRATEGY
  '736cd845': { cat: 'instructor_strategy', action: 'silence', notes: 'Internal discussion about content/customers' },
  
  // TEST MESSAGES (Joel testing) - treat as support_technical for eval purposes
  '9cd38d6b': { cat: 'support_technical', action: 'respond', notes: 'Test: AI stolen job, groceries' },
  '0c336520': { cat: 'support_technical', action: 'respond', notes: 'Test: duplicate' },
  '7599fe27': { cat: 'support_technical', action: 'respond', notes: 'Test: duplicate' },
  'd6e5cd99': { cat: 'support_technical', action: 'respond', notes: 'Test: cant figure out TS' },
}

function scrubPII(text: string): string {
  return text
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi, '[EMAIL]')
    .replace(/\b(Milan|Stojke|Jason|John|Thomas|Leonard|Urban|Kevin|Arvind|Denis|Christian|Fiona|Martin|Aminata|Andrew|Dan|Thorr|Zan)\b/gi, 'Customer')
}

async function main() {
  const raw = await readFile('fixtures/datasets/comprehensive-dataset.json', 'utf-8')
  const convos = JSON.parse(raw)
  
  const scenarios: any[] = []
  let labeled = 0
  let unlabeled = 0
  
  for (const conv of convos) {
    const id = conv.id.slice(0, 8)
    const label = LABELS[id]
    
    if (!label) {
      console.log(`UNLABELED: ${id} - ${conv.triggerMessage.subject.slice(0, 50)}`)
      unlabeled++
      continue
    }
    
    labeled++
    
    // Build thread - oldest to newest, stop at trigger
    const history = [...conv.conversationHistory].reverse()
    let lastInIdx = -1
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].direction === 'in') {
        lastInIdx = i
        break
      }
    }
    
    const msgs = (lastInIdx >= 0 ? history.slice(0, lastInIdx + 1) : history)
      .map((m: any) => ({
        direction: m.direction,
        body: scrubPII(m.body),
        timestamp: m.timestamp,
      }))
    
    if (msgs.length === 0) continue
    
    scenarios.push({
      id: `real_${id}`,
      notes: label.notes,
      input: {
        conversationId: conv.conversationId,
        appId: conv.app || 'unknown',
        messages: msgs,
        triggerMessage: msgs[msgs.length - 1],
      },
      expected: {
        category: label.cat,
        action: label.action,
      },
      tags: [label.cat, label.action, msgs.length === 1 ? 'single' : 'multi_turn'],
    })
  }
  
  await writeFile('fixtures/datasets/real-threads.json', JSON.stringify(scenarios, null, 2))
  
  console.log(`\nLabeled: ${labeled}`)
  console.log(`Unlabeled: ${unlabeled}`)
  console.log(`Scenarios: ${scenarios.length}`)
  
  // Category breakdown
  const cats: Record<string, number> = {}
  const actions: Record<string, number> = {}
  for (const s of scenarios) {
    cats[s.expected.category] = (cats[s.expected.category] || 0) + 1
    actions[s.expected.action] = (actions[s.expected.action] || 0) + 1
  }
  
  console.log('\nCategories:')
  for (const [k, v] of Object.entries(cats).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k}: ${v}`)
  }
  
  console.log('\nActions:')
  for (const [k, v] of Object.entries(actions).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k}: ${v}`)
  }
}

main().catch(console.error)
