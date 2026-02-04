import { homedir } from 'os'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'
import type { Command } from 'commander'
import { type CommandContext, createContext } from '../core/context'
import { CLIError, formatError } from '../core/errors'
import { copy, ensureDir, pathExists, readJson } from '../core/fs-extra'

type PluginManifest = {
  name?: string
  version?: string
  displayName?: string
  description?: string
  author?: string
  skills?: string[]
  cliVersion?: string
} & Record<string, unknown>

const PLUGIN_SOURCE_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../plugin'
)

const PLUGIN_MANIFEST_RELATIVE = join('.claude-plugin', 'plugin.json')

const resolveTargetDir = (global?: boolean): string => {
  const base = join(homedir(), '.claude', global ? 'skills' : 'plugins')
  return join(base, 'skill-cli')
}

const readManifest = async (path: string): Promise<PluginManifest> => {
  const manifest = (await readJson(path)) as PluginManifest
  if (!manifest || typeof manifest.version !== 'string') {
    throw new CLIError({
      userMessage: 'Invalid plugin.json: missing version.',
      suggestion: 'Check packages/cli/plugin/.claude-plugin/plugin.json.',
    })
  }
  return manifest
}

const formatTargetLabel = (global?: boolean): string =>
  global ? '~/.claude/skills/skill-cli' : '~/.claude/plugins/skill-cli'

const writeResult = (
  ctx: CommandContext,
  payload: Record<string, unknown>
): void => {
  if (ctx.format === 'json') {
    ctx.output.data(payload)
    return
  }

  const status = typeof payload.status === 'string' ? payload.status : 'unknown'
  const version = typeof payload.version === 'string' ? payload.version : 'n/a'
  const target = typeof payload.target === 'string' ? payload.target : ''
  const note = typeof payload.note === 'string' ? payload.note : ''

  ctx.output.data(`Plugin sync: ${status}`)
  ctx.output.data(`Version: ${version}`)
  if (target) ctx.output.data(`Target: ${target}`)
  if (note) ctx.output.data(note)
}

export async function executePluginSync(
  ctx: CommandContext,
  options: {
    global?: boolean
    dry?: boolean
    force?: boolean
  }
): Promise<void> {
  try {
    const sourceManifestPath = join(PLUGIN_SOURCE_DIR, PLUGIN_MANIFEST_RELATIVE)
    const sourceExists = await pathExists(sourceManifestPath)

    if (!sourceExists) {
      throw new CLIError({
        userMessage: 'Plugin source not found.',
        suggestion: 'Check packages/cli/plugin/.claude-plugin/plugin.json.',
      })
    }

    const sourceManifest = await readManifest(sourceManifestPath)
    const targetDir = resolveTargetDir(options.global)
    const targetManifestPath = join(targetDir, PLUGIN_MANIFEST_RELATIVE)
    const targetExists = await pathExists(targetManifestPath)

    if (targetExists && !options.force) {
      const targetManifest = await readManifest(targetManifestPath)
      if (targetManifest.version === sourceManifest.version) {
        writeResult(ctx, {
          status: 'up-to-date',
          version: sourceManifest.version,
          target: formatTargetLabel(options.global),
          note: 'Installed plugin is already up to date. Use --force to re-sync.',
        })
        return
      }
    }

    if (options.dry) {
      writeResult(ctx, {
        status: 'dry-run',
        version: sourceManifest.version,
        target: formatTargetLabel(options.global),
        note: 'Dry run only. No files were written.',
      })
      return
    }

    await ensureDir(targetDir)
    await copy(PLUGIN_SOURCE_DIR, targetDir)

    writeResult(ctx, {
      status: 'synced',
      version: sourceManifest.version,
      target: formatTargetLabel(options.global),
      note: 'Plugin synced successfully.',
    })
  } catch (error) {
    const formatted = formatError(error)
    ctx.output.error(formatted)
    process.exitCode = error instanceof CLIError ? error.exitCode : 1
  }
}

export const registerPluginSyncCommand = (program: Command): void => {
  const plugin = program
    .command('plugin')
    .description('Manage Claude Code plugins')

  plugin
    .command('sync')
    .description('Sync the skill-cli plugin to your Claude Code directory')
    .option('--global', 'Sync to ~/.claude/skills/skill-cli instead of plugins')
    .option('--dry', 'Show what would change without writing files')
    .option('--force', 'Re-sync even if the version matches')
    .action(
      async (
        options: { global?: boolean; dry?: boolean; force?: boolean },
        command: Command
      ) => {
        const opts =
          typeof command.optsWithGlobals === 'function'
            ? command.optsWithGlobals()
            : {
                ...command.parent?.opts(),
                ...command.opts(),
              }

        const ctx = await createContext({
          format: opts.format,
          verbose: opts.verbose,
          quiet: opts.quiet,
        })

        await executePluginSync(ctx, {
          global: options.global,
          dry: options.dry,
          force: options.force,
        })
      }
    )
}
