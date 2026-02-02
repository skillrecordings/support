#!/usr/bin/env bun

import * as fs from 'node:fs/promises'
import * as path from 'node:path'

const SKILLS_DIR = path.join(process.cwd(), 'skills')

interface SkillAudit {
  skill: string
  path: string
  ok: boolean
  errors: string[]
  warnings: string[]
  stats: {
    bodyLines: number
    bodyTokens: number
  }
  frontmatter: {
    name?: string
    description?: string
    license?: string
    metadata?: Record<string, string>
    hasCompatibility: boolean
  }
}

interface FrontmatterParseResult {
  name?: string
  description?: string
  license?: string
  metadata?: Record<string, string>
  hasCompatibility: boolean
  errors: string[]
}

function stripQuotes(value: string): string {
  return value.replace(/^['"]|['"]$/g, '').trim()
}

function extractBlock(lines: string[], startIndex: number): { value: string; endIndex: number } {
  const collected: string[] = []
  let index = startIndex + 1
  for (; index < lines.length; index += 1) {
    const line = lines[index]
    if (!line.startsWith(' ') && !line.startsWith('\t') && line.trim() !== '') {
      break
    }
    collected.push(line.replace(/^\s+/, ''))
  }
  return { value: collected.join('\n').trim(), endIndex: index - 1 }
}

function parseMetadata(lines: string[], startIndex: number): { metadata: Record<string, string>; endIndex: number; errors: string[] } {
  const metadata: Record<string, string> = {}
  const errors: string[] = []
  let index = startIndex + 1
  for (; index < lines.length; index += 1) {
    const line = lines[index]
    if (line.trim() === '') continue
    if (!line.startsWith(' ') && !line.startsWith('\t')) {
      break
    }
    const trimmed = line.replace(/^\s+/, '')
    const separatorIndex = trimmed.indexOf(':')
    if (separatorIndex === -1) {
      errors.push(`metadata entry is missing ':' on line ${index + 1}`)
      continue
    }
    const key = trimmed.slice(0, separatorIndex).trim()
    const value = trimmed.slice(separatorIndex + 1).trim()
    if (!key) {
      errors.push(`metadata entry has empty key on line ${index + 1}`)
      continue
    }
    metadata[key] = stripQuotes(value)
  }
  return { metadata, endIndex: index - 1, errors }
}

function parseFrontmatter(frontmatter: string): FrontmatterParseResult {
  const lines = frontmatter.split(/\r?\n/)
  const result: FrontmatterParseResult = {
    hasCompatibility: false,
    errors: [],
  }

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    if (!line.trim()) continue
    if (line.startsWith(' ') || line.startsWith('\t')) continue

    const separatorIndex = line.indexOf(':')
    if (separatorIndex === -1) continue

    const key = line.slice(0, separatorIndex).trim()
    const rawValue = line.slice(separatorIndex + 1).trim()

    if (key === 'compatibility') {
      result.hasCompatibility = true
      continue
    }

    if (key === 'name') {
      if (rawValue === '|' || rawValue === '>') {
        const block = extractBlock(lines, i)
        result.name = block.value
        i = block.endIndex
      } else {
        result.name = stripQuotes(rawValue)
      }
      continue
    }

    if (key === 'description') {
      if (rawValue === '|' || rawValue === '>') {
        const block = extractBlock(lines, i)
        result.description = block.value
        i = block.endIndex
      } else {
        result.description = stripQuotes(rawValue)
      }
      continue
    }

    if (key === 'license') {
      if (rawValue === '|' || rawValue === '>') {
        const block = extractBlock(lines, i)
        result.license = block.value
        i = block.endIndex
      } else {
        result.license = stripQuotes(rawValue)
      }
      continue
    }

    if (key === 'metadata') {
      if (rawValue && rawValue !== '|' && rawValue !== '>') {
        result.errors.push('metadata must be a key-value map, not a scalar')
        continue
      }
      const parsed = parseMetadata(lines, i)
      result.metadata = parsed.metadata
      result.errors.push(...parsed.errors)
      i = parsed.endIndex
    }
  }

  return result
}

function getFrontmatterSections(content: string): { frontmatter?: string; body: string; errors: string[] } {
  const errors: string[] = []
  const trimmed = content.trimStart()
  if (!trimmed.startsWith('---')) {
    return { body: content, errors: ['missing frontmatter delimiter'] }
  }

  const lines = content.split(/\r?\n/)
  if (lines[0].trim() !== '---') {
    return { body: content, errors: ['frontmatter must start at first line'] }
  }

  let endIndex = -1
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === '---') {
      endIndex = i
      break
    }
  }

  if (endIndex === -1) {
    return { body: content, errors: ['missing closing frontmatter delimiter'] }
  }

  const frontmatter = lines.slice(1, endIndex).join('\n')
  const body = lines.slice(endIndex + 1).join('\n')
  return { frontmatter, body, errors }
}

function validateDescription(description: string): string[] {
  const errors: string[] = []
  const trimmed = description.trim()
  if (trimmed.length < 1 || trimmed.length > 1024) {
    errors.push('description must be 1-1024 characters')
  }
  const lower = trimmed.toLowerCase()
  const hasWhen = /(when|if|trigger|triggers|used|use|for)\b/.test(lower)
  if (!hasWhen) {
    errors.push('description should include when to use the skill')
  }
  return errors
}

function validateName(name: string, dirName: string): string[] {
  const errors: string[] = []
  if (name.length < 1 || name.length > 64) {
    errors.push('name must be 1-64 characters')
  }
  if (!/^[a-z0-9-]+$/.test(name)) {
    errors.push('name must be lowercase alphanumeric with hyphens')
  }
  if (name !== dirName) {
    errors.push(`name must match directory name (${dirName})`)
  }
  return errors
}

async function auditSkill(dirPath: string, dirName: string): Promise<SkillAudit> {
  const skillFile = path.join(dirPath, 'SKILL.md')
  const errors: string[] = []
  const warnings: string[] = []
  let body = ''
  let bodyLines = 0
  let bodyTokens = 0

  try {
    const content = await fs.readFile(skillFile, 'utf-8')
    const sections = getFrontmatterSections(content)
    errors.push(...sections.errors.map(error => `frontmatter: ${error}`))
    body = sections.body

    const frontmatterData = sections.frontmatter ? parseFrontmatter(sections.frontmatter) : {
      hasCompatibility: false,
      errors: [],
    }

    errors.push(...frontmatterData.errors)

    if (!frontmatterData.name) {
      errors.push('name is required')
    } else {
      errors.push(...validateName(frontmatterData.name, dirName))
    }

    if (!frontmatterData.description) {
      errors.push('description is required')
    } else {
      errors.push(...validateDescription(frontmatterData.description))
    }

    if (frontmatterData.hasCompatibility) {
      errors.push('compatibility field is not allowed')
    }

    bodyLines = body.split(/\r?\n/).length
    if (bodyLines > 500) {
      warnings.push(`body exceeds 500 lines (${bodyLines})`)
    }

    bodyTokens = body.trim() ? body.trim().split(/\s+/).length : 0
    if (bodyTokens > 5000) {
      warnings.push(`body exceeds 5000 tokens (${bodyTokens})`)
    }

    return {
      skill: dirName,
      path: skillFile,
      ok: errors.length === 0,
      errors,
      warnings,
      stats: { bodyLines, bodyTokens },
      frontmatter: {
        name: frontmatterData.name,
        description: frontmatterData.description,
        license: frontmatterData.license,
        metadata: frontmatterData.metadata,
        hasCompatibility: frontmatterData.hasCompatibility,
      },
    }
  } catch (error) {
    return {
      skill: dirName,
      path: skillFile,
      ok: false,
      errors: [`failed to read SKILL.md: ${(error as Error).message}`],
      warnings: [],
      stats: { bodyLines, bodyTokens },
      frontmatter: {
        hasCompatibility: false,
      },
    }
  }
}

async function main() {
  const entries = await fs.readdir(SKILLS_DIR, { withFileTypes: true })
  const skillDirs = entries.filter(entry => entry.isDirectory()).map(entry => entry.name)

  console.log(`Skills audit started: ${skillDirs.length} skills found.`)

  const results: SkillAudit[] = []
  for (const dirName of skillDirs) {
    const dirPath = path.join(SKILLS_DIR, dirName)
    const skillFile = path.join(dirPath, 'SKILL.md')
    try {
      await fs.access(skillFile)
      const result = await auditSkill(dirPath, dirName)
      results.push(result)
    } catch {
      results.push({
        skill: dirName,
        path: skillFile,
        ok: false,
        errors: ['SKILL.md is missing'],
        warnings: [],
        stats: { bodyLines: 0, bodyTokens: 0 },
        frontmatter: { hasCompatibility: false },
      })
    }
  }

  for (const result of results) {
    if (result.ok && result.warnings.length === 0) {
      console.log(`OK ${result.skill}: valid`)
      continue
    }

    console.log(`\n${result.ok ? 'WARN' : 'FAIL'} ${result.skill}`)
    for (const error of result.errors) {
      console.log(`  - error: ${error}`)
    }
    for (const warning of result.warnings) {
      console.log(`  - warning: ${warning}`)
    }
  }

  const summary = {
    total: results.length,
    valid: results.filter(result => result.ok).length,
    invalid: results.filter(result => !result.ok).length,
    warnings: results.filter(result => result.warnings.length > 0).length,
    needsFix: results.filter(result => result.errors.length > 0 || result.warnings.length > 0),
  }

  console.log('\nAudit complete.')
  console.log('JSON summary:')
  console.log(JSON.stringify(summary, null, 2))
}

main().catch(error => {
  console.error('audit failed:', error)
  process.exit(1)
})
