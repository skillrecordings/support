#!/usr/bin/env npx tsx
/**
 * DRY RUN: Preview template organization without making changes
 */

import * as fs from 'fs'
import * as path from 'path'

// Existing folder IDs from audit
const EXISTING_FOLDERS = {
  'Just JavaScript': 'rsf_4xhj',
  'egghead': 'rsf_4ytj',
  'Total TypeScript': 'rsf_4z9j',
  'Technical Interviews': 'rsf_4zbb',
  'Auto-responders': 'rsf_4zev',
  'Live Events': 'rsf_4zgn',
  'z - In Review': 'rsf_4zif',
  'KCD': 'rsf_4zk7',
  'Pure React': 'rsf_4zuv',
} as const

const FOLDERS_TO_CREATE = [
  'Epic Web',
  'Epic React',
  'Testing JavaScript',
  'AI Hero',
  'Shared',
] as const

// Template categorization rules
function categorizeTemplate(name: string, body: string): { folder: string; reason: string } {
  const nameLower = name.toLowerCase()
  const bodyLower = body.toLowerCase()
  
  // Total TypeScript
  if (nameLower.startsWith('tt:') || nameLower.startsWith('tt ') ||
      nameLower.includes('total typescript') ||
      bodyLower.includes('totaltypescript.com') ||
      (nameLower.includes('matt') && (nameLower.includes('discord') || nameLower.includes('collaboration')))) {
    return { folder: 'Total TypeScript', reason: 'TT prefix or totaltypescript.com reference' }
  }
  
  // egghead
  if (nameLower.startsWith('eh:') || nameLower.startsWith('egg:') ||
      nameLower.includes('egghead') ||
      bodyLower.includes('egghead.io') ||
      nameLower === 'instructor inquiry' ||
      nameLower === 'joel collaboration') {
    return { folder: 'egghead', reason: 'egghead prefix or egghead.io reference' }
  }
  
  // Epic React
  if (nameLower.startsWith('er:') || nameLower.startsWith('er ') ||
      nameLower.includes('epic react') ||
      bodyLower.includes('epicreact.dev')) {
    return { folder: 'Epic React', reason: 'ER prefix or epicreact.dev reference' }
  }
  
  // Epic Web
  if (nameLower.startsWith('ew:') || nameLower.startsWith('ew ') || nameLower.startsWith('ewd') ||
      nameLower.includes('epic web') || nameLower.includes('epic bundle') ||
      bodyLower.includes('epicweb.dev')) {
    return { folder: 'Epic Web', reason: 'EW prefix or epicweb.dev reference' }
  }
  
  // KCD
  if (nameLower.includes('kcd') || 
      bodyLower.includes('kcd.im') ||
      bodyLower.includes('kentcdodds.com') ||
      (nameLower.includes('collaboration') && bodyLower.includes('kent'))) {
    return { folder: 'KCD', reason: 'KCD reference or kentcdodds.com' }
  }
  
  // Just JavaScript
  if (nameLower.includes('just javascript') ||
      bodyLower.includes('justjavascript.com')) {
    return { folder: 'Just JavaScript', reason: 'Just JavaScript reference' }
  }
  
  // Pure React
  if (nameLower.includes('pure react') ||
      bodyLower.includes('purereact.com')) {
    return { folder: 'Pure React', reason: 'Pure React reference' }
  }
  
  // Technical Interviews
  if (nameLower.includes('technical interviews') ||
      bodyLower.includes('technicalinterviews.dev')) {
    return { folder: 'Technical Interviews', reason: 'Technical Interviews reference' }
  }
  
  // Testing JavaScript
  if (nameLower.includes('testing js') || nameLower.includes('testing javascript') ||
      nameLower.includes('tjs') ||
      bodyLower.includes('testingjavascript.com')) {
    return { folder: 'Testing JavaScript', reason: 'Testing JavaScript reference' }
  }
  
  // AI Hero
  if (nameLower.includes('ai hero') ||
      bodyLower.includes('aihero.dev') ||
      bodyLower.includes('epicai.pro')) {
    return { folder: 'AI Hero', reason: 'AI Hero or Epic AI reference' }
  }
  
  // Auto-responders (check for business hours patterns)
  if (nameLower.includes('auto-responder') ||
      nameLower.includes('business hours') ||
      nameLower.includes('autoresponder')) {
    return { folder: 'Auto-responders', reason: 'Auto-responder pattern' }
  }
  
  // Live Events
  if (nameLower.includes('live event') || nameLower.includes('live workshop') ||
      nameLower.includes('workshop recording') || nameLower.includes('workshop feedback') ||
      nameLower.includes('cursor workshop')) {
    return { folder: 'Live Events', reason: 'Live event/workshop reference' }
  }
  
  // Shared (generic responses that work across products)
  return { folder: 'Shared', reason: 'Generic/cross-product template' }
}

async function main() {
  console.log('🔍 DRY RUN: Template Organization Preview\n')
  
  // Load template audit data
  const auditDataPath = path.join(__dirname, '../docs/template-audit-data.json')
  const auditData = JSON.parse(fs.readFileSync(auditDataPath, 'utf-8'))
  
  // Build folder map
  const folderMap: Record<string, string> = { ...EXISTING_FOLDERS }
  for (const f of FOLDERS_TO_CREATE) {
    folderMap[f] = `NEW:${f}` // placeholder
  }
  
  // Categorize templates
  const byFolder: Record<string, { name: string; id: string; reason: string }[]> = {}
  
  for (const template of auditData.templates) {
    const { folder, reason } = categorizeTemplate(template.name, template.body)
    
    if (!byFolder[folder]) {
      byFolder[folder] = []
    }
    byFolder[folder].push({
      name: template.name,
      id: template.id,
      reason,
    })
  }
  
  // Print summary
  console.log('📁 FOLDERS TO CREATE:')
  for (const f of FOLDERS_TO_CREATE) {
    console.log(`  - ${f}`)
  }
  
  console.log('\n📊 TEMPLATE DISTRIBUTION:\n')
  
  const sortedFolders = Object.entries(byFolder).sort((a, b) => b[1].length - a[1].length)
  
  for (const [folder, templates] of sortedFolders) {
    const isNew = FOLDERS_TO_CREATE.includes(folder as any)
    console.log(`\n${isNew ? '🆕' : '📁'} ${folder} (${templates.length} templates)`)
    console.log('─'.repeat(50))
    for (const t of templates) {
      console.log(`  • ${t.name} (${t.id})`)
    }
  }
  
  // Summary
  console.log('\n\n' + '═'.repeat(60))
  console.log('SUMMARY')
  console.log('═'.repeat(60))
  console.log(`Total templates: ${auditData.templates.length}`)
  console.log('\nBy folder:')
  for (const [folder, templates] of sortedFolders) {
    const isNew = FOLDERS_TO_CREATE.includes(folder as any)
    console.log(`  ${isNew ? '🆕' : '  '} ${folder.padEnd(25)} ${templates.length}`)
  }
  
  console.log('\n✅ To apply these changes, run: npx tsx scripts/organize-templates.ts')
}

main().catch(console.error)
