#!/usr/bin/env npx tsx
/**
 * Front Template Audit Script
 * 
 * Pulls all templates from Front API and generates a comprehensive audit report.
 * 
 * Usage: npx tsx scripts/template-audit.ts
 */

import { createFrontClient, type MessageTemplate, type MessageTemplateFolder } from '../packages/front-sdk/src/index.js'
import * as fs from 'fs'
import * as path from 'path'

// Load env from packages/cli/.env.local manually
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
  console.error('❌ FRONT_API_TOKEN not found in environment')
  process.exit(1)
}

const front = createFrontClient({ apiToken: FRONT_API_TOKEN })

// Similarity calculation using Jaccard index on word sets
function jaccardSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(w => w.length > 2))
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(w => w.length > 2))
  
  if (wordsA.size === 0 && wordsB.size === 0) return 1
  if (wordsA.size === 0 || wordsB.size === 0) return 0
  
  const intersection = new Set([...wordsA].filter(x => wordsB.has(x)))
  const union = new Set([...wordsA, ...wordsB])
  
  return intersection.size / union.size
}

// Extract variables from template body
function extractVariables(body: string): string[] {
  const varPattern = /\{\{([^}]+)\}\}/g
  const matches = [...body.matchAll(varPattern)]
  return [...new Set(matches.map(m => m[1].trim()))]
}

// Check for potentially outdated content
interface OutdatedFlag {
  template: MessageTemplate
  reason: string
  match: string
}

function checkOutdatedContent(template: MessageTemplate): OutdatedFlag[] {
  const flags: OutdatedFlag[] = []
  const content = template.body + ' ' + template.subject
  
  // Old years (before current year)
  const currentYear = new Date().getFullYear()
  const yearPattern = /\b(201\d|202[0-4])\b/g
  const yearMatches = content.match(yearPattern)
  if (yearMatches) {
    for (const year of yearMatches) {
      if (parseInt(year) < currentYear) {
        flags.push({ template, reason: 'Old year reference', match: year })
      }
    }
  }
  
  // Price amounts (may need review)
  const pricePattern = /\$\d+(?:\.\d{2})?/g
  const priceMatches = content.match(pricePattern)
  if (priceMatches) {
    for (const price of priceMatches) {
      flags.push({ template, reason: 'Price amount (verify current)', match: price })
    }
  }
  
  // Old product names or potential stale references
  const stalePatterns = [
    /testing\s+javascript/i,
    /testingjavascript/i,
    /just\s+javascript/i,
    /egghead\.io/i,  // May be outdated references
  ]
  for (const pattern of stalePatterns) {
    const match = content.match(pattern)
    if (match) {
      flags.push({ template, reason: 'Potential stale product reference', match: match[0] })
    }
  }
  
  return flags
}

// Find duplicate groups
interface DuplicateGroup {
  similarity: number
  templates: MessageTemplate[]
}

function findDuplicates(templates: MessageTemplate[], threshold = 0.85): DuplicateGroup[] {
  const groups: DuplicateGroup[] = []
  const assigned = new Set<string>()
  
  for (let i = 0; i < templates.length; i++) {
    if (assigned.has(templates[i].id)) continue
    
    const group: MessageTemplate[] = [templates[i]]
    let minSimilarity = 1
    
    for (let j = i + 1; j < templates.length; j++) {
      if (assigned.has(templates[j].id)) continue
      
      const sim = jaccardSimilarity(templates[i].body, templates[j].body)
      if (sim >= threshold) {
        group.push(templates[j])
        assigned.add(templates[j].id)
        minSimilarity = Math.min(minSimilarity, sim)
      }
    }
    
    if (group.length > 1) {
      assigned.add(templates[i].id)
      groups.push({ similarity: minSimilarity, templates: group })
    }
  }
  
  return groups.sort((a, b) => b.similarity - a.similarity)
}

async function main() {
  console.log('🔍 Fetching all templates from Front API...\n')
  
  // Fetch all templates (single call - Front typically has <100 templates)
  const templateResult = await front.templates.list()
  const templates = templateResult._results as MessageTemplate[]
  
  // Handle pagination if there's a next page
  let nextUrl = templateResult._pagination?.next
  while (nextUrl) {
    const nextPage = await front.raw.get<any>(nextUrl)
    templates.push(...nextPage._results)
    nextUrl = nextPage._pagination?.next
  }
  
  console.log(`✅ Found ${templates.length} templates\n`)
  
  // Fetch all folders
  console.log('📁 Fetching template folders...\n')
  const folderResult = await front.templates.listFolders()
  const folders = folderResult._results as MessageTemplateFolder[]
  
  console.log(`✅ Found ${folders.length} folders\n`)
  
  // Create folder lookup map
  const folderMap = new Map<string, MessageTemplateFolder>()
  for (const folder of folders) {
    folderMap.set(folder.id, folder)
  }
  
  // Fetch inboxes for context
  console.log('📥 Fetching inboxes...\n')
  const inboxResult = await front.inboxes.list()
  const inboxes = inboxResult._results
  console.log(`✅ Found ${inboxes.length} inboxes\n`)
  
  // Analyze templates
  console.log('📊 Analyzing templates...\n')
  
  // Count templates by inbox scope
  const globalTemplates = templates.filter(t => t.is_available_for_all_inboxes)
  const scopedTemplates = templates.filter(t => !t.is_available_for_all_inboxes)
  
  // Templates without folders
  const noFolderTemplates = templates.filter(t => !t.folder)
  
  // Find duplicates
  const duplicateGroups = findDuplicates(templates, 0.85)
  
  // Check for outdated content
  const outdatedFlags: OutdatedFlag[] = []
  for (const template of templates) {
    outdatedFlags.push(...checkOutdatedContent(template))
  }
  
  // Extract all variables used
  const allVariables = new Map<string, number>()
  for (const template of templates) {
    const vars = extractVariables(template.body)
    for (const v of vars) {
      allVariables.set(v, (allVariables.get(v) || 0) + 1)
    }
  }
  
  // Generate report
  const report = generateReport({
    templates,
    folders,
    folderMap,
    inboxes,
    globalTemplates,
    scopedTemplates,
    noFolderTemplates,
    duplicateGroups,
    outdatedFlags,
    allVariables
  })
  
  // Save report
  const docsDir = path.join(process.cwd(), 'docs')
  if (!fs.existsSync(docsDir)) {
    fs.mkdirSync(docsDir, { recursive: true })
  }
  
  const reportPath = path.join(docsDir, 'template-audit-report.md')
  fs.writeFileSync(reportPath, report)
  console.log(`\n✅ Report saved to: ${reportPath}`)
  
  // Also save raw data as JSON for further analysis
  const dataPath = path.join(docsDir, 'template-audit-data.json')
  fs.writeFileSync(dataPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    templates: templates.map(t => ({
      id: t.id,
      name: t.name,
      subject: t.subject,
      body: t.body,
      is_available_for_all_inboxes: t.is_available_for_all_inboxes,
      folder: t.folder,
      variables: extractVariables(t.body)
    })),
    folders: folders.map(f => ({ id: f.id, name: f.name })),
    inboxes: inboxes.map((i: any) => ({ id: i.id, name: i.name }))
  }, null, 2))
  console.log(`✅ Raw data saved to: ${dataPath}`)
  
  // Print summary
  console.log('\n' + '='.repeat(60))
  console.log('📋 AUDIT SUMMARY')
  console.log('='.repeat(60))
  console.log(`Total templates:     ${templates.length}`)
  console.log(`Template folders:    ${folders.length}`)
  console.log(`Global (unscoped):   ${globalTemplates.length}`)
  console.log(`Inbox-scoped:        ${scopedTemplates.length}`)
  console.log(`No folder assigned:  ${noFolderTemplates.length}`)
  console.log(`Duplicate groups:    ${duplicateGroups.length}`)
  console.log(`Outdated flags:      ${outdatedFlags.length}`)
  console.log('='.repeat(60))
}

interface ReportData {
  templates: MessageTemplate[]
  folders: MessageTemplateFolder[]
  folderMap: Map<string, MessageTemplateFolder>
  inboxes: any[]
  globalTemplates: MessageTemplate[]
  scopedTemplates: MessageTemplate[]
  noFolderTemplates: MessageTemplate[]
  duplicateGroups: DuplicateGroup[]
  outdatedFlags: OutdatedFlag[]
  allVariables: Map<string, number>
}

function generateReport(data: ReportData): string {
  const {
    templates,
    folders,
    folderMap,
    inboxes,
    globalTemplates,
    scopedTemplates,
    noFolderTemplates,
    duplicateGroups,
    outdatedFlags,
    allVariables
  } = data
  
  const lines: string[] = []
  
  lines.push('# Front Template Audit Report')
  lines.push(`Generated: ${new Date().toISOString().split('T')[0]}`)
  lines.push('')
  lines.push('## Summary')
  lines.push('')
  lines.push(`- **Total templates:** ${templates.length}`)
  lines.push(`- **Template folders:** ${folders.length}`)
  lines.push(`- **Global (unscoped):** ${globalTemplates.length}`)
  lines.push(`- **Inbox-scoped:** ${scopedTemplates.length}`)
  lines.push(`- **No folder assigned:** ${noFolderTemplates.length}`)
  lines.push(`- **Potential duplicate groups:** ${duplicateGroups.length}`)
  lines.push(`- **Outdated content flags:** ${outdatedFlags.length}`)
  lines.push('')
  
  // Template Folders
  lines.push('## Template Folders')
  lines.push('')
  if (folders.length > 0) {
    lines.push('| Folder | ID |')
    lines.push('|--------|-----|')
    for (const folder of folders) {
      lines.push(`| ${folder.name} | \`${folder.id}\` |`)
    }
  } else {
    lines.push('*No folders found*')
  }
  lines.push('')
  
  // Inboxes
  lines.push('## Inboxes')
  lines.push('')
  if (inboxes.length > 0) {
    lines.push('| Inbox | ID |')
    lines.push('|-------|-----|')
    for (const inbox of inboxes) {
      lines.push(`| ${inbox.name} | \`${inbox.id}\` |`)
    }
  }
  lines.push('')
  
  // Duplicate Groups
  lines.push('## Potential Duplicate Groups')
  lines.push('')
  if (duplicateGroups.length > 0) {
    for (let i = 0; i < duplicateGroups.length; i++) {
      const group = duplicateGroups[i]
      lines.push(`### Group ${i + 1} (${Math.round(group.similarity * 100)}% similar)`)
      lines.push('')
      for (const t of group.templates) {
        const folder = t.folder ? folderMap.get(t.folder)?.name || 'Unknown' : 'No folder'
        lines.push(`- **"${t.name}"** (\`${t.id}\`) - Folder: ${folder}`)
      }
      lines.push('')
    }
  } else {
    lines.push('*No significant duplicates found (>85% similarity)*')
    lines.push('')
  }
  
  // Outdated Content
  lines.push('## Potentially Outdated Content')
  lines.push('')
  if (outdatedFlags.length > 0) {
    const groupedFlags = new Map<string, OutdatedFlag[]>()
    for (const flag of outdatedFlags) {
      const key = flag.template.id
      if (!groupedFlags.has(key)) {
        groupedFlags.set(key, [])
      }
      groupedFlags.get(key)!.push(flag)
    }
    
    lines.push('| Template | Issue | Match |')
    lines.push('|----------|-------|-------|')
    for (const [templateId, flags] of groupedFlags) {
      const template = templates.find(t => t.id === templateId)!
      for (const flag of flags) {
        lines.push(`| "${template.name}" (\`${templateId}\`) | ${flag.reason} | \`${flag.match}\` |`)
      }
    }
  } else {
    lines.push('*No obviously outdated content detected*')
  }
  lines.push('')
  
  // Templates without folders
  lines.push('## Templates Without Folder Assignment')
  lines.push('')
  if (noFolderTemplates.length > 0) {
    lines.push('These templates have no folder and may need organization:')
    lines.push('')
    for (const t of noFolderTemplates.slice(0, 50)) {
      const scope = t.is_available_for_all_inboxes ? 'Global' : 'Scoped'
      lines.push(`- **"${t.name}"** (\`${t.id}\`) - ${scope}`)
    }
    if (noFolderTemplates.length > 50) {
      lines.push(`- ... and ${noFolderTemplates.length - 50} more`)
    }
  } else {
    lines.push('*All templates are assigned to folders*')
  }
  lines.push('')
  
  // Global/Unscoped Templates
  lines.push('## Global (Unscoped) Templates')
  lines.push('')
  lines.push('These templates are available to all inboxes and may need inbox-specific scoping:')
  lines.push('')
  if (globalTemplates.length > 0) {
    for (const t of globalTemplates.slice(0, 30)) {
      const folder = t.folder ? folderMap.get(t.folder)?.name || 'Unknown' : 'No folder'
      lines.push(`- **"${t.name}"** (\`${t.id}\`) - Folder: ${folder}`)
    }
    if (globalTemplates.length > 30) {
      lines.push(`- ... and ${globalTemplates.length - 30} more`)
    }
  } else {
    lines.push('*No global templates*')
  }
  lines.push('')
  
  // Variables used
  lines.push('## Variables Used in Templates')
  lines.push('')
  lines.push('| Variable | Usage Count |')
  lines.push('|----------|-------------|')
  const sortedVars = [...allVariables.entries()].sort((a, b) => b[1] - a[1])
  for (const [variable, count] of sortedVars.slice(0, 30)) {
    lines.push(`| \`{{${variable}}}\` | ${count} |`)
  }
  if (sortedVars.length > 30) {
    lines.push(`| ... | ${sortedVars.length - 30} more |`)
  }
  lines.push('')
  
  // All Templates List
  lines.push('## Complete Template List')
  lines.push('')
  lines.push('<details>')
  lines.push('<summary>Click to expand (all templates)</summary>')
  lines.push('')
  lines.push('| Name | ID | Folder | Scope |')
  lines.push('|------|-----|--------|-------|')
  for (const t of templates) {
    const folder = t.folder ? folderMap.get(t.folder)?.name || 'Unknown' : '-' 
    const scope = t.is_available_for_all_inboxes ? 'Global' : 'Scoped'
    const escapedName = t.name.replace(/\|/g, '\\|')
    lines.push(`| ${escapedName} | \`${t.id}\` | ${folder} | ${scope} |`)
  }
  lines.push('')
  lines.push('</details>')
  lines.push('')
  
  // Recommendations
  lines.push('## Recommendations')
  lines.push('')
  lines.push('### Priority Actions')
  lines.push('')
  if (duplicateGroups.length > 0) {
    lines.push(`1. **Review ${duplicateGroups.length} duplicate groups** - Consolidate or differentiate similar templates`)
  }
  if (globalTemplates.length > 0) {
    lines.push(`2. **Scope ${globalTemplates.length} global templates** - Assign to specific inboxes where appropriate`)
  }
  if (noFolderTemplates.length > 0) {
    lines.push(`3. **Organize ${noFolderTemplates.length} unfoldered templates** - Create folders for better organization`)
  }
  if (outdatedFlags.length > 0) {
    lines.push(`4. **Review ${outdatedFlags.length} outdated content flags** - Update stale dates, prices, or references`)
  }
  lines.push('')
  lines.push('### Folder Strategy')
  lines.push('')
  lines.push('Consider organizing templates by:')
  lines.push('- **Product** (TotalTypeScript, EpicWeb, EpicReact, etc.)')
  lines.push('- **Type** (Refunds, Technical Support, Shipping, etc.)')
  lines.push('- **Stage** (Pre-sale, Post-sale, Account Issues, etc.)')
  lines.push('')
  
  return lines.join('\n')
}

main().catch(console.error)
