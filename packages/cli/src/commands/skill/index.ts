/**
 * Skill management commands
 *
 * Create and manage Claude skills with YAML frontmatter format.
 */

import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { Command } from 'commander'

const SKILL_TEMPLATE = `---
name: {{name}}
description: {{description}}
allowed-tools: {{tools}}
---

# {{title}}

## Quick start

\`\`\`bash
# Add your quick start commands here
\`\`\`

## Commands

<!-- Document your commands here -->

## Example

\`\`\`bash
# Add usage examples here
\`\`\`
`

/**
 * Command: skill skill create <name>
 * Create a new skill with YAML frontmatter
 */
async function createSkill(
  name: string,
  options: {
    description?: string
    tools?: string
    path?: string
  }
): Promise<void> {
  const skillName = name.toLowerCase().replace(/\s+/g, '-')
  const title = name
    .split(/[-_\s]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')

  // Determine skill path
  const basePath = options.path || process.cwd()
  const skillDir = join(basePath, '.claude', 'skills', skillName)

  if (existsSync(skillDir)) {
    console.error(`Error: Skill directory already exists: ${skillDir}`)
    process.exit(1)
  }

  // Create directory
  mkdirSync(skillDir, { recursive: true })

  // Generate SKILL.md content
  const content = SKILL_TEMPLATE.replace(/{{name}}/g, skillName)
    .replace(/{{title}}/g, title)
    .replace(
      /{{description}}/g,
      options.description || `Use when working with ${title}.`
    )
    .replace(/{{tools}}/g, options.tools || 'Read, Edit, Bash')

  // Write SKILL.md
  const skillPath = join(skillDir, 'SKILL.md')
  writeFileSync(skillPath, content)

  console.log(`\nCreated skill: ${skillName}`)
  console.log(`  Path: ${skillPath}`)
  console.log(`\nNext steps:`)
  console.log(`  1. Edit ${skillPath} to add your skill content`)
  console.log(`  2. Update .claude/skills/README.md to list your skill`)
}

/**
 * Command: skill skill list
 * List available skills
 */
async function listSkills(options: {
  path?: string
  json?: boolean
}): Promise<void> {
  const { readdirSync, readFileSync } = await import('fs')
  const basePath = options.path || process.cwd()
  const skillsDir = join(basePath, '.claude', 'skills')

  if (!existsSync(skillsDir)) {
    if (options.json) {
      console.log(JSON.stringify({ skills: [] }))
    } else {
      console.log('No skills directory found.')
    }
    return
  }

  const entries = readdirSync(skillsDir, { withFileTypes: true })
  const skills: { name: string; description: string; path: string }[] = []

  for (const entry of entries) {
    if (!entry.isDirectory()) continue

    const skillPath = join(skillsDir, entry.name, 'SKILL.md')
    if (!existsSync(skillPath)) continue

    const content = readFileSync(skillPath, 'utf-8')
    const match = content.match(/^---\n([\s\S]*?)\n---/)

    let description = ''
    if (match && match[1]) {
      const frontmatter = match[1]
      const descMatch = frontmatter.match(/description:\s*(.+)/)
      if (descMatch && descMatch[1]) {
        description = descMatch[1].trim()
      }
    }

    skills.push({
      name: entry.name,
      description:
        description.slice(0, 80) + (description.length > 80 ? '...' : ''),
      path: skillPath,
    })
  }

  if (options.json) {
    console.log(JSON.stringify({ skills }, null, 2))
    return
  }

  if (skills.length === 0) {
    console.log('No skills found.')
    return
  }

  console.log('\nAvailable skills:\n')
  for (const skill of skills.sort((a, b) => a.name.localeCompare(b.name))) {
    console.log(`  ${skill.name}`)
    if (skill.description) {
      console.log(`    ${skill.description}`)
    }
  }
  console.log('')
}

/**
 * Register skill commands with Commander
 */
export function registerSkillCommands(program: Command): void {
  const skills = program.command('skills').description('Manage Claude skills')

  skills
    .command('create')
    .description('Create a new skill')
    .argument('<name>', 'Skill name (e.g., my-tool)')
    .option('-d, --description <desc>', 'Skill description')
    .option('-t, --tools <tools>', 'Allowed tools (comma-separated)')
    .option('-p, --path <path>', 'Base path for .claude/skills/')
    .action(createSkill)

  skills
    .command('list')
    .description('List available skills')
    .option('-p, --path <path>', 'Base path to search')
    .option('--json', 'Output as JSON')
    .action(listSkills)
}
