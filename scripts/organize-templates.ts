#!/usr/bin/env npx tsx
/**
 * Phase 2: Organize Templates into Folders
 * 
 * This script:
 * 1. Creates missing template folders
 * 2. Assigns templates to appropriate folders based on content analysis
 * 3. Logs all changes for audit trail
 */

import { createFrontClient } from '../packages/front-sdk/src/index.js'
import * as fs from 'fs'
import * as path from 'path'

// Load env from packages/cli/.env.local manually (same as audit script)
const envPath = path.join(import.meta.dirname || process.cwd(), '../packages/cli/.env.local')
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8')
  for (const line of envContent.split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/)
    if (match) {
      const key = match[1].trim()
      const value = match[2].replace(/^["']|["']$/g, '').trim()
      if (!process.env[key]) {
        process.env[key] = value
      }
    }
  }
}

const FRONT_API_TOKEN = process.env.FRONT_API_TOKEN
if (!FRONT_API_TOKEN) {
  console.error('❌ FRONT_API_TOKEN not found in environment or packages/cli/.env.local')
  process.exit(1)
}

const front = createFrontClient({ apiToken: FRONT_API_TOKEN })

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

// Folders to create
const FOLDERS_TO_CREATE = [
  'Epic Web',
  'Epic React',
  'Testing JavaScript',
  'AI Hero',
  'Shared',
] as const

// Inbox mappings (for reference - some templates should be scoped)
const INBOXES = {
  'Total TypeScript': 'inb_3srbb',
  'egghead support': 'inb_1zh3b',
  'Epic Web': 'inb_jqs2t',
  'KCD Support': 'inb_1bwzr',
  'Pure React Support': 'inb_2l41z',
  'Just JavaScript': 'inb_2odqf',
  'Technical Interviews': 'inb_355hj',
  'AI Hero': 'inb_4bj7r',
  'Pro Tailwind': 'inb_3pqh3',
} as const

interface TemplateAssignment {
  templateId: string
  templateName: string
  targetFolder: string
  targetFolderId?: string
  reason: string
  currentScope: 'global' | 'scoped'
  suggestedInbox?: string
}

// Template categorization rules
function categorizeTemplate(name: string, body: string): { folder: string; reason: string; suggestedInbox?: string } {
  const nameLower = name.toLowerCase()
  const bodyLower = body.toLowerCase()
  
  // Total TypeScript (check first for TT prefix patterns)
  if (nameLower.startsWith('tt:') || nameLower.startsWith('tt ') ||
      nameLower.includes('total typescript') ||
      bodyLower.includes('totaltypescript.com') ||
      (nameLower.includes('matt') && (nameLower.includes('discord') || nameLower.includes('collaboration')))) {
    return { folder: 'Total TypeScript', reason: 'TT prefix or totaltypescript.com reference', suggestedInbox: 'Total TypeScript' }
  }
  
  // Epic React (check before egghead due to "er:" prefix)
  // Also catch "Course Length - ER" pattern
  if (nameLower.startsWith('er:') || nameLower.startsWith('er ') ||
      nameLower.includes('epic react') ||
      nameLower.endsWith(' - er') ||
      bodyLower.includes('epicreact.dev')) {
    return { folder: 'Epic React', reason: 'ER prefix or epicreact.dev reference' }
  }
  
  // egghead
  if (nameLower.startsWith('eh:') || nameLower.startsWith('egg:') ||
      nameLower.includes('egghead') ||
      bodyLower.includes('egghead.io') ||
      nameLower === 'instructor inquiry' ||
      nameLower === 'joel collaboration') {
    return { folder: 'egghead', reason: 'egghead prefix or egghead.io reference', suggestedInbox: 'egghead support' }
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
      bodyLower.includes('justjavascript.com') ||
      bodyLower.includes('just javascript')) {
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

interface ChangeLog {
  timestamp: string
  created_folders: string[]
  template_updates: {
    templateId: string
    templateName: string
    oldFolder: string | null
    newFolder: string
    newFolderId: string
    reason: string
  }[]
  summary: {
    total_templates: number
    templates_moved: number
    folders_created: number
    by_folder: Record<string, number>
  }
}

async function main() {
  console.log('🚀 Starting template organization...\n')
  
  const changeLog: ChangeLog = {
    timestamp: new Date().toISOString(),
    created_folders: [],
    template_updates: [],
    summary: {
      total_templates: 0,
      templates_moved: 0,
      folders_created: 0,
      by_folder: {},
    },
  }
  
  // Load template audit data
  const auditDataPath = path.join(__dirname, '../docs/template-audit-data.json')
  const auditData = JSON.parse(fs.readFileSync(auditDataPath, 'utf-8'))
  
  // Build folder map (existing + to create)
  const folderMap: Record<string, string> = { ...EXISTING_FOLDERS }
  
  // Step 1: Create missing folders
  console.log('📁 Creating missing folders...')
  for (const folderName of FOLDERS_TO_CREATE) {
    if (!folderMap[folderName]) {
      try {
        console.log(`  Creating folder: ${folderName}`)
        const folder = await front.templates.createFolder(folderName)
        folderMap[folderName] = folder.id
        changeLog.created_folders.push(folderName)
        console.log(`  ✅ Created: ${folderName} (${folder.id})`)
      } catch (error: any) {
        if (error.message?.includes('already exists')) {
          console.log(`  ⚠️ Folder already exists: ${folderName}`)
        } else {
          console.error(`  ❌ Failed to create ${folderName}:`, error.message)
        }
      }
    }
  }
  changeLog.summary.folders_created = changeLog.created_folders.length
  console.log('')
  
  // Step 2: Categorize and assign templates
  console.log('📝 Categorizing templates...')
  const assignments: TemplateAssignment[] = []
  
  for (const template of auditData.templates) {
    const { folder, reason, suggestedInbox } = categorizeTemplate(template.name, template.body)
    const folderId = folderMap[folder]
    
    if (!folderId) {
      console.log(`  ⚠️ No folder ID for "${folder}" - skipping ${template.name}`)
      continue
    }
    
    assignments.push({
      templateId: template.id,
      templateName: template.name,
      targetFolder: folder,
      targetFolderId: folderId,
      reason,
      currentScope: template.is_available_for_all_inboxes ? 'global' : 'scoped',
      suggestedInbox,
    })
    
    // Track by folder
    changeLog.summary.by_folder[folder] = (changeLog.summary.by_folder[folder] || 0) + 1
  }
  
  changeLog.summary.total_templates = assignments.length
  
  // Step 3: Apply folder updates
  console.log('\n📤 Applying folder assignments...')
  
  let processed = 0
  let errors = 0
  
  for (const assignment of assignments) {
    try {
      process.stdout.write(`\r  Processing ${++processed}/${assignments.length}: ${assignment.templateName.substring(0, 40).padEnd(40)}`)
      
      await front.templates.update(assignment.templateId, {
        folder_id: assignment.targetFolderId!,
      })
      
      changeLog.template_updates.push({
        templateId: assignment.templateId,
        templateName: assignment.templateName,
        oldFolder: null, // All were unassigned
        newFolder: assignment.targetFolder,
        newFolderId: assignment.targetFolderId!,
        reason: assignment.reason,
      })
      
      // Rate limiting - Front API has limits
      await new Promise(resolve => setTimeout(resolve, 100))
      
    } catch (error: any) {
      errors++
      console.error(`\n  ❌ Error updating ${assignment.templateName}: ${error.message}`)
    }
  }
  
  changeLog.summary.templates_moved = changeLog.template_updates.length
  
  console.log(`\n\n✅ Organization complete!`)
  console.log(`   Folders created: ${changeLog.summary.folders_created}`)
  console.log(`   Templates moved: ${changeLog.summary.templates_moved}`)
  console.log(`   Errors: ${errors}`)
  console.log('\n   By folder:')
  for (const [folder, count] of Object.entries(changeLog.summary.by_folder).sort((a, b) => b[1] - a[1])) {
    console.log(`     ${folder}: ${count}`)
  }
  
  // Write change log
  const logPath = path.join(__dirname, '../docs/template-cleanup-log.md')
  const logContent = generateMarkdownLog(changeLog)
  fs.writeFileSync(logPath, logContent)
  console.log(`\n📄 Change log written to: docs/template-cleanup-log.md`)
  
  // Also write JSON log for reference
  const jsonLogPath = path.join(__dirname, '../docs/template-organization-changes.json')
  fs.writeFileSync(jsonLogPath, JSON.stringify(changeLog, null, 2))
  console.log(`📄 JSON log written to: docs/template-organization-changes.json`)
  
  return changeLog
}

function generateMarkdownLog(log: ChangeLog): string {
  return `# Template Organization Log

Generated: ${log.timestamp}

## Summary

- **Total templates processed:** ${log.summary.total_templates}
- **Templates moved to folders:** ${log.summary.templates_moved}
- **Folders created:** ${log.summary.folders_created}

## Folders Created

${log.created_folders.length > 0 ? log.created_folders.map(f => `- ${f}`).join('\n') : '_No new folders created_'}

## Templates by Folder

| Folder | Count |
|--------|-------|
${Object.entries(log.summary.by_folder)
  .sort((a, b) => b[1] - a[1])
  .map(([folder, count]) => `| ${folder} | ${count} |`)
  .join('\n')}

## Detailed Changes

${log.template_updates
  .sort((a, b) => a.newFolder.localeCompare(b.newFolder))
  .map(u => `- **${u.templateName}** (\`${u.templateId}\`) → ${u.newFolder}
  - Reason: ${u.reason}`)
  .join('\n')}

---

_This log was generated by the template organization script._
`
}

// Run if executed directly
main()
  .then((log) => {
    console.log('\n🎉 Done!')
    process.exit(0)
  })
  .catch((error) => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
