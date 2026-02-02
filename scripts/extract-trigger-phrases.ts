#!/usr/bin/env bun

import * as fs from 'node:fs/promises'
import * as path from 'node:path'

const SKILLS_DIR = path.join(process.cwd(), 'skills')
const DUCKDB_PATH = path.join(process.cwd(), 'artifacts/phase-0/embeddings/v2/temp.duckdb')
const MIN_PHRASE_FREQ = 2
const MAX_PHRASES = 10

interface SkillData {
  name: string
  description: string
  path: string
  hasTriggerPhrases: boolean
  content: string
}

// Common stopwords to filter out
const STOPWORDS = new Set([
  'i', 'me', 'my', 'we', 'our', 'you', 'your', 'the', 'a', 'an', 'and', 'or', 'but',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does',
  'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'shall', 'can',
  'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through',
  'this', 'that', 'these', 'those', 'it', 'its', 'if', 'then', 'so', 'than', 'too',
  'very', 'just', 'also', 'now', 'here', 'there', 'when', 'where', 'why', 'how', 'all',
  'each', 'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'not',
  'only', 'same', 'any', 'hi', 'hello', 'hey', 'thanks', 'thank', 'please', 'regards',
  'sincerely', 'best', 'dear', 'team', 'support', 'help', 'need', 'want', 'like', 'get',
  'know', 'see', 'use', 'try', 'let', 'make', 'take', 'come', 'go', 'give', 'tell', 'ask',
  'work', 'seem', 'feel', 'think', 'look', 'find', 'day', 'way', 'thing', 'man', 'time',
  'year', 'people', 'mr', 'ms', 'mrs', 'dr', 'etc', 'am', 'pm', 'im', 'ive', 'dont', 'cant',
  'wont', 'isnt', 'arent', 'didnt', 'doesnt', 'hasnt', 'havent', 'hadnt', 'wasnt', 'werent'
])

// Generic greetings/closings to filter out
const GENERIC_PATTERNS = [
  /^(hi|hello|hey|dear|good\s+(morning|afternoon|evening))/i,
  /^(thanks|thank\s+you|best\s+regards|sincerely)/i,
  /^(i\s+(am|was|have|had|would|need|want|like|hope|wish))/i,
]

function extractNgrams(text: string, n: number): string[] {
  const words = text.toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOPWORDS.has(w))
  
  const ngrams: string[] = []
  for (let i = 0; i <= words.length - n; i++) {
    const ngram = words.slice(i, i + n).join(' ')
    if (ngram.length > 5) ngrams.push(ngram)
  }
  return ngrams
}

function isGenericPhrase(phrase: string): boolean {
  return GENERIC_PATTERNS.some(p => p.test(phrase))
}

async function loadSkills(): Promise<SkillData[]> {
  const skills: SkillData[] = []
  const entries = await fs.readdir(SKILLS_DIR, { withFileTypes: true })
  
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const skillPath = path.join(SKILLS_DIR, entry.name, 'SKILL.md')
    
    try {
      const content = await fs.readFile(skillPath, 'utf-8')
      const fmMatch = content.match(/^---\n([\s\S]*?)\n---/)
      if (!fmMatch) continue
      
      const fm = fmMatch[1]
      const nameMatch = fm.match(/name:\s*["']?([^"'\n]+)["']?/)
      const descMatch = fm.match(/description:\s*["']?([^"'\n]+)["']?/)
      const hasTrigger = /trigger_phrases:/.test(fm)
      
      skills.push({
        name: nameMatch?.[1] || entry.name,
        description: descMatch?.[1] || '',
        path: skillPath,
        hasTriggerPhrases: hasTrigger,
        content
      })
    } catch {
      // Skip
    }
  }
  
  return skills
}

async function getConversationsForSkill(db: any, skillName: string): Promise<string[]> {
  const topicName = skillName.replace(/-/g, '_')
  
  try {
    const rows = await db.all(`
      SELECT first_message 
      FROM conversations 
      WHERE tags LIKE '%${topicName}%' OR tags LIKE '%${skillName}%'
      LIMIT 200
    `)
    return rows.map((r: any) => r.first_message).filter(Boolean)
  } catch {
    return []
  }
}

function extractTriggerPhrases(messages: string[], description: string): string[] {
  const phraseCounts: Record<string, number> = {}
  
  // Extract 2-4 grams from all messages
  for (const msg of messages) {
    for (let n = 2; n <= 4; n++) {
      const ngrams = extractNgrams(msg, n)
      for (const ngram of ngrams) {
        if (!isGenericPhrase(ngram)) {
          phraseCounts[ngram] = (phraseCounts[ngram] || 0) + 1
        }
      }
    }
  }
  
  // Sort by frequency and take top phrases
  const sorted = Object.entries(phraseCounts)
    .filter(([_, count]) => count >= MIN_PHRASE_FREQ)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_PHRASES * 2) // Take extra to filter
  
  // Filter out overlapping phrases (prefer longer)
  const selected: string[] = []
  for (const [phrase] of sorted) {
    const isSubstring = selected.some(s => s.includes(phrase) || phrase.includes(s))
    if (!isSubstring && selected.length < MAX_PHRASES) {
      selected.push(phrase)
    }
  }
  
  // If not enough phrases from data, generate from description
  if (selected.length < 3 && description) {
    const descPhrases = extractNgrams(description, 2)
      .filter(p => !selected.includes(p))
      .slice(0, 3 - selected.length)
    selected.push(...descPhrases)
  }
  
  return selected
}

function updateTriggerPhrases(content: string, phrases: string[]): string {
  const yamlPhrases = phrases.map(p => `    - "${p}"`).join('\n')
  const triggerBlock = `trigger_phrases:\n${yamlPhrases}`
  
  // Check if trigger_phrases exists
  if (/trigger_phrases:/.test(content)) {
    return content.replace(
      /trigger_phrases:\n([\s\S]*?)(?=\n[a-z_]+:|---)/,
      triggerBlock + '\n'
    )
  }
  
  // Add to metadata section
  if (/metadata:/.test(content)) {
    return content.replace(
      /(metadata:\n)/,
      `$1  ${triggerBlock.replace(/\n/g, '\n  ')}\n`
    )
  }
  
  // Add metadata section
  const insertPoint = content.indexOf('\n---\n') + 5
  return content.slice(0, insertPoint) + 
    `\nmetadata:\n  ${triggerBlock.replace(/\n/g, '\n  ')}\n` +
    content.slice(insertPoint)
}

async function main() {
  console.log('=== Extract Trigger Phrases ===\n')
  
  const { Database } = await import('duckdb-async')
  const db = await Database.create(DUCKDB_PATH, { access_mode: 'READ_ONLY' })
  
  const skills = await loadSkills()
  console.log(`Loaded ${skills.length} skills`)
  
  const needsTrigger = skills.filter(s => !s.hasTriggerPhrases)
  console.log(`Skills needing trigger_phrases: ${needsTrigger.length}\n`)
  
  let updated = 0
  
  for (const skill of skills) {
    console.log(`Processing: ${skill.name}`)
    
    const messages = await getConversationsForSkill(db, skill.name)
    console.log(`  - Found ${messages.length} conversations`)
    
    const phrases = extractTriggerPhrases(messages, skill.description)
    if (phrases.length === 0) {
      console.log(`  - No phrases extracted`)
      continue
    }
    
    console.log(`  - Phrases: ${phrases.slice(0, 5).join(', ')}${phrases.length > 5 ? '...' : ''}`)
    
    const newContent = updateTriggerPhrases(skill.content, phrases)
    await fs.writeFile(skill.path, newContent)
    updated++
  }
  
  await db.close()
  
  console.log(`\n=== Done ===`)
  console.log(`Updated ${updated} skills with trigger phrases`)
  
  // Verify
  const remaining = (await loadSkills()).filter(s => !s.hasTriggerPhrases).length
  console.log(`Skills still needing trigger_phrases: ${remaining}`)
}

main().catch(console.error)
