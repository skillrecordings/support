/**
 * Auto-symlink skill-cli skill to ~/.claude/skills/
 *
 * Creates a symlink on CLI startup so the skill is always available.
 * Skips if target already exists (conflict detection).
 */

import { lstat, readlink, symlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SKILL_SOURCE_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../.claude/skills/skill-cli'
)

const SKILL_TARGET_DIR = join(homedir(), '.claude', 'skills', 'skill-cli')

export interface LinkResult {
  status: 'linked' | 'exists' | 'conflict' | 'error'
  source: string
  target: string
  message?: string
}

/**
 * Auto-link the skill-cli skill directory to ~/.claude/skills/skill-cli
 *
 * - If target doesn't exist: create symlink
 * - If target is already a symlink to our source: skip (already linked)
 * - If target exists but is something else: skip with warning (conflict)
 */
export async function autoLinkSkill(): Promise<LinkResult> {
  const source = SKILL_SOURCE_DIR
  const target = SKILL_TARGET_DIR

  try {
    // Check if target exists
    let stats
    try {
      stats = await lstat(target)
    } catch (e: unknown) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
        // Target doesn't exist - create symlink
        // Ensure parent directory exists
        const { mkdir } = await import('node:fs/promises')
        await mkdir(dirname(target), { recursive: true })
        await symlink(source, target, 'dir')
        return {
          status: 'linked',
          source,
          target,
          message: `Linked skill-cli to ${target}`,
        }
      }
      throw e
    }

    // Target exists - check if it's already our symlink
    if (stats.isSymbolicLink()) {
      const linkTarget = await readlink(target)
      const resolvedLinkTarget = resolve(dirname(target), linkTarget)

      if (resolvedLinkTarget === source || linkTarget === source) {
        return {
          status: 'exists',
          source,
          target,
          message: 'Skill already linked',
        }
      }

      // Symlink to somewhere else
      return {
        status: 'conflict',
        source,
        target,
        message: `Conflict: ${target} is a symlink to ${linkTarget}`,
      }
    }

    // Target exists and is a regular file/directory
    return {
      status: 'conflict',
      source,
      target,
      message: `Conflict: ${target} already exists`,
    }
  } catch (error) {
    return {
      status: 'error',
      source,
      target,
      message: error instanceof Error ? error.message : String(error),
    }
  }
}
