import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { Command } from 'commander'
import { createContext } from '../core/context'

interface Skill {
  name: string
  description: string
  path: string
}

/**
 * Discover skills from .claude/skills directory
 */
export function discoverSkills(skillsDir: string): Skill[] {
  if (!existsSync(skillsDir)) {
    return []
  }

  const skills: Skill[] = []

  try {
    const entries = readdirSync(skillsDir)

    for (const entry of entries) {
      const entryPath = join(skillsDir, entry)
      const stat = statSync(entryPath)

      if (!stat.isDirectory()) continue

      const skillPath = join(entryPath, 'SKILL.md')
      if (!existsSync(skillPath)) continue

      const content = readFileSync(skillPath, 'utf8')
      const description = extractDescription(content)

      skills.push({
        name: entry,
        description,
        path: skillPath,
      })
    }
  } catch {
    return []
  }

  return skills.sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Extract first paragraph after heading (ignoring frontmatter)
 */
function extractDescription(markdown: string): string {
  const lines = markdown.split('\n')
  let inFrontmatter = false
  let foundHeading = false
  const descriptionLines: string[] = []

  for (const line of lines) {
    const trimmed = line.trim()

    // Handle frontmatter
    if (trimmed === '---') {
      if (!inFrontmatter && !foundHeading) {
        inFrontmatter = true
        continue
      } else if (inFrontmatter) {
        inFrontmatter = false
        continue
      }
    }

    if (inFrontmatter) continue

    // Found heading
    if (trimmed.startsWith('# ')) {
      foundHeading = true
      continue
    }

    // Stop at next heading or double newline after description
    if (foundHeading && trimmed.startsWith('#')) {
      break
    }

    // Collect description lines after heading
    if (foundHeading) {
      if (trimmed === '') {
        if (descriptionLines.length > 0) {
          // Empty line after description = end
          break
        }
        continue
      }
      descriptionLines.push(trimmed)
    }
  }

  return descriptionLines.join(' ').trim()
}

async function listAction(options: { json?: boolean }, command: Command) {
  const ctx = await createContext({
    format: options.json ? 'json' : command.optsWithGlobals().format,
    verbose: command.optsWithGlobals().verbose,
    quiet: command.optsWithGlobals().quiet,
  })

  const skillsDir = join(process.cwd(), '.claude', 'skills')
  const skills = discoverSkills(skillsDir)

  if (options.json) {
    ctx.output.data({ skills })
    return
  }

  if (skills.length === 0) {
    ctx.output.message('No skills found in .claude/skills/')
    return
  }

  ctx.output.data(`\n📚 Available Skills (${skills.length})`)
  ctx.output.data('─'.repeat(80))

  // Table output
  const rows = skills.map((skill) => ({
    Name: skill.name,
    Description: skill.description || '(no description)',
  }))

  ctx.output.table(rows)
}

export function registerListCommand(program: Command): void {
  program
    .command('list')
    .description('List available CLI skills for programmatic discovery')
    .option('--json', 'Output as JSON')
    .action(listAction)
}
