#!/usr/bin/env bun

import * as fs from 'node:fs/promises'
import * as path from 'node:path'

const SKILLS_DIR = path.join(process.cwd(), 'skills')
const QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6333'
const SIMILARITY_THRESHOLD = 0.6
const MAX_RELATED = 5

interface QdrantSearchResult {
  result: Array<{
    id: number
    score: number
    payload: {
      name: string
      description: string
    }
  }>
}

interface SkillData {
  name: string
  description: string
  path: string
  hasRelatedSkills: boolean
  content: string
}

async function getSkillEmbedding(skillName: string): Promise<number[] | null> {
  const response = await fetch(`${QDRANT_URL}/collections/skills/points/scroll`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filter: {
        must: [{ key: 'name', match: { value: skillName } }]
      },
      with_vector: true,
      limit: 1
    })
  })
  if (!response.ok) return null
  const data = await response.json()
  return data.result?.points?.[0]?.vector || null
}

async function searchSimilarSkills(embedding: number[], excludeName: string): Promise<string[]> {
  const response = await fetch(`${QDRANT_URL}/collections/skills/points/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      vector: embedding,
      limit: MAX_RELATED + 1, // +1 to exclude self
      with_payload: true,
    })
  })
  if (!response.ok) return []
  const data: QdrantSearchResult = await response.json()
  
  return data.result
    .filter(r => r.payload.name !== excludeName && r.score >= SIMILARITY_THRESHOLD)
    .slice(0, MAX_RELATED)
    .map(r => r.payload.name)
}

async function loadSkills(): Promise<SkillData[]> {
  const skills: SkillData[] = []
  const entries = await fs.readdir(SKILLS_DIR, { withFileTypes: true })
  
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const skillPath = path.join(SKILLS_DIR, entry.name, 'SKILL.md')
    
    try {
      const content = await fs.readFile(skillPath, 'utf-8')
      
      // Parse frontmatter
      const fmMatch = content.match(/^---\n([\s\S]*?)\n---/)
      if (!fmMatch) continue
      
      const fm = fmMatch[1]
      const nameMatch = fm.match(/name:\s*["']?([^"'\n]+)["']?/)
      const descMatch = fm.match(/description:\s*["']?([^"'\n]+)["']?/)
      const hasRelated = /related_skills:\s*\[/.test(fm) && !/related_skills:\s*\[\s*\]/.test(fm)
      
      skills.push({
        name: nameMatch?.[1] || entry.name,
        description: descMatch?.[1] || '',
        path: skillPath,
        hasRelatedSkills: hasRelated,
        content
      })
    } catch {
      // Skip if can't read
    }
  }
  
  return skills
}

function updateRelatedSkills(content: string, relatedSkills: string[]): string {
  const relatedStr = relatedSkills.length > 0 
    ? `[${relatedSkills.map(s => `"${s}"`).join(', ')}]`
    : '[]'
  
  // Check if related_skills exists in metadata section
  if (/related_skills:/.test(content)) {
    return content.replace(
      /related_skills:\s*\[[^\]]*\]/,
      `related_skills: ${relatedStr}`
    )
  }
  
  // Add to metadata section if it exists
  if (/metadata:/.test(content)) {
    return content.replace(
      /(metadata:\n)/,
      `$1  related_skills: ${relatedStr}\n`
    )
  }
  
  // Add metadata section before the first heading
  const insertPoint = content.indexOf('\n---\n') + 5
  return content.slice(0, insertPoint) + 
    `\nmetadata:\n  related_skills: ${relatedStr}\n` +
    content.slice(insertPoint)
}

async function main() {
  console.log('=== Fill Related Skills ===\n')
  
  const skills = await loadSkills()
  console.log(`Loaded ${skills.length} skills`)
  
  const emptyRelated = skills.filter(s => !s.hasRelatedSkills)
  console.log(`Skills needing related_skills: ${emptyRelated.length}\n`)
  
  let updated = 0
  
  for (const skill of emptyRelated) {
    console.log(`Processing: ${skill.name}`)
    
    // Get embedding from Qdrant
    const embedding = await getSkillEmbedding(skill.name)
    if (!embedding) {
      console.log(`  - No embedding found, skipping`)
      continue
    }
    
    // Find similar skills
    const related = await searchSimilarSkills(embedding, skill.name)
    if (related.length === 0) {
      console.log(`  - No similar skills above threshold`)
      continue
    }
    
    console.log(`  - Found: ${related.join(', ')}`)
    
    // Update the file
    const newContent = updateRelatedSkills(skill.content, related)
    await fs.writeFile(skill.path, newContent)
    updated++
  }
  
  console.log(`\n=== Done ===`)
  console.log(`Updated ${updated}/${emptyRelated.length} skills`)
  
  // Verify
  const remaining = (await loadSkills()).filter(s => !s.hasRelatedSkills).length
  console.log(`Skills still needing related_skills: ${remaining}`)
}

main().catch(console.error)
