#!/usr/bin/env bun

// Load .env.local before any module that validates env vars (e.g., @skillrecordings/database)
// Bun auto-loads .env in the cwd, but CLI may run from anywhere — explicitly load from package root.
//
// Config loading priority (when decryption is implemented):
// 1. Load shipped defaults from packages/cli/.env.encrypted
// 2. Load user overrides from ~/.config/skill/.env.user.encrypted
// 3. User values override shipped values
// 4. Track provenance for write-gating (isUserKey() check)
//
// For now, we use plaintext .env.local fallback until worker-1 implements decryption.

import { resolve } from 'node:path'
import { loadPlaintextEnv } from './core/config-loader'

const cliRoot = resolve(import.meta.dirname, '..')
const plaintextEnv = loadPlaintextEnv(cliRoot)

let envLoaded = false
for (const [key, value] of Object.entries(plaintextEnv)) {
  if (!process.env[key]) {
    process.env[key] = value
    envLoaded = true
  }
}

// Skip env validation when no .env file found (e.g., global npm install, --help, --version)
// Commands that need DATABASE_URL will fail at runtime with a clear error instead.
if (!envLoaded && !process.env.DATABASE_URL) {
  process.env.SKIP_ENV_VALIDATION = '1'
}

// TODO: Replace with loadConfigChain() once worker-1 implements decryptEnvFile()
// This will enable:
// - Shipped defaults from .env.encrypted
// - User overrides from ~/.config/skill/.env.user.encrypted
// - Provenance tracking for write-gating

import { Command } from 'commander'
import { registerAuthCommands } from './commands/auth/index'
import { registerAxiomCommands } from './commands/axiom/index'
import { registerDatasetCommands } from './commands/build-dataset'
import { registerConfigCommands } from './commands/config/index'
import { registerDbStatusCommand } from './commands/db-status'
import { registerDeployCommands } from './commands/deploys'
import { runEval } from './commands/eval'
import { registerEvalLocalCommands } from './commands/eval-local/index'
import { registerEvalPipelineCommands } from './commands/eval-pipeline/index'
import { registerEvalPromptCommands } from './commands/eval-prompt'
import { registerFaqCommands } from './commands/faq'
import { registerFrontCommands } from './commands/front/index'
import { health } from './commands/health'
import { init } from './commands/init'
import { registerInngestCommands } from './commands/inngest/index'
import { registerKbCommands } from './commands/kb-sync'
import { registerLinearCommands } from './commands/linear/index'
import { registerMemoryCommands } from './commands/memory/index'
import { registerPipelineCommands } from './commands/pipeline'
import { registerPluginSyncCommand } from './commands/plugin-sync'
import { registerResponseCommands } from './commands/responses'
import { registerToolsCommands } from './commands/tools'
import { wizard } from './commands/wizard'
import {
  getAuthAdaptiveDescription,
  getFrontAdaptiveDescription,
  getInngestAdaptiveDescription,
  getRootAdaptiveDescription,
} from './core/adaptive-help'
import { autoUpdateAfterCommand } from './core/auto-update'
import { createContext } from './core/context'
import { HintEngine, writeHints } from './core/hint-engine'
import { autoLinkSkill } from './core/skill-link'
import { resolveTelemetryUser, sendTelemetryEvent } from './core/telemetry'
import { getUsageTracker } from './core/usage-tracker'
import { createMcpServer } from './mcp/server'

// BUILD_* are injected at compile time via bun --define.
// In dev mode they don't exist, so we use typeof checks to avoid ReferenceError.
const runtimeTarget = `bun-${process.platform}-${process.arch}`
const buildVersion =
  typeof BUILD_VERSION !== 'undefined' && BUILD_VERSION.length > 0
    ? BUILD_VERSION
    : '0.0.0-dev'
const buildCommit =
  typeof BUILD_COMMIT !== 'undefined' && BUILD_COMMIT.length > 0
    ? BUILD_COMMIT
    : 'dev'
const buildTarget =
  typeof BUILD_TARGET !== 'undefined' && BUILD_TARGET.length > 0
    ? BUILD_TARGET
    : runtimeTarget
const isDevBuild = buildVersion.includes('dev') || buildCommit === 'dev'

declare const BUILD_VERSION: string
declare const BUILD_COMMIT: string
declare const BUILD_TARGET: string

const versionLabel = `skill v${buildVersion} (${buildCommit}) ${buildTarget}`

const program = new Command()
const hintEngine = new HintEngine()
const usageTracker = getUsageTracker()
const usageState = await (async () => {
  try {
    return await usageTracker.getUsage()
  } catch {
    return null
  }
})()
const hintCounts = new WeakMap<Command, number>()
const commandStartTimes = new WeakMap<Command, number>()

const resolveCommandName = (command: Command): string => {
  const names: string[] = []
  let current: Command | null | undefined = command
  while (current) {
    const name = current.name()
    if (name) names.unshift(name)
    current = current.parent
  }
  if (names[0] === 'skill') names.shift()
  return names.join('.')
}

const resolveHintContext = (command: Command) => {
  const opts =
    typeof command.optsWithGlobals === 'function'
      ? command.optsWithGlobals()
      : {
          ...command.parent?.opts(),
          ...command.opts(),
        }
  const outputJson = opts.json === true || opts.format === 'json'
  const suppressForPipe =
    process.env.SKILL_CLI_FORCE_HINTS === '1'
      ? false
      : process.stdout.isTTY !== true

  return {
    command: resolveCommandName(command),
    format: outputJson ? 'json' : opts.format,
    quiet: opts.quiet === true || suppressForPipe,
  }
}

const resolveMilestones = (commandName: string): string[] => {
  switch (commandName) {
    case 'wizard':
      return ['wizard_completed']
    case 'auth.setup':
    case 'init':
      return ['auth_configured']
    default:
      return []
  }
}

program
  .name('skill')
  .description(getRootAdaptiveDescription(usageState))
  .version(versionLabel)
  .option('-f, --format <format>', 'Output format (json|text|table)')
  .option('-v, --verbose', 'Enable verbose output')
  .option('-q, --quiet', 'Suppress non-error output')
  .option('--rate-limit <n>', 'Override Front API rate limit per minute', (v) =>
    Number.parseInt(v, 10)
  )

// Show guided help when run with no args
program.addHelpText(
  'after',
  '\n  Need help? Start with:\n' +
    '    skill auth setup            Set up credentials (1Password)\n' +
    '    skill front inbox            See what needs attention\n' +
    '    skill --help                 This message\n'
)

program.hook('preAction', (thisCommand, actionCommand) => {
  const opts =
    typeof actionCommand.optsWithGlobals === 'function'
      ? actionCommand.optsWithGlobals()
      : thisCommand.opts()
  const rateLimit = opts.rateLimit
  if (typeof rateLimit === 'number' && Number.isFinite(rateLimit)) {
    process.env.SKILL_RATE_LIMIT = String(rateLimit)
  }
})

program.hook('preAction', (_thisCommand, actionCommand) => {
  commandStartTimes.set(actionCommand, Date.now())
})

program.hook('preAction', async (_thisCommand, actionCommand) => {
  try {
    const context = resolveHintContext(actionCommand)
    const state = await usageTracker.getUsage()
    const hints = hintEngine.getHints(state, context)
    writeHints(hints, process.stderr)
    hintCounts.set(actionCommand, hints.length)
  } catch {
    // Never let hint rendering break the CLI.
  }
})

program.hook('postAction', async (_thisCommand, actionCommand) => {
  try {
    const context = resolveHintContext(actionCommand)
    const state = await usageTracker.record(context.command)
    const milestones = resolveMilestones(context.command)
    for (const milestone of milestones) {
      await usageTracker.setMilestone(milestone)
    }
    const previouslyShown = hintCounts.get(actionCommand) ?? 0
    const postHint = hintEngine.getPostRunHint(state, {
      ...context,
      previouslyShown,
    })
    if (postHint) writeHints([postHint], process.stderr)
  } catch {
    // Never let usage tracking break the CLI.
  }

  try {
    const startTime = commandStartTimes.get(actionCommand) ?? Date.now()
    const duration = Math.max(0, Date.now() - startTime)
    const exitCode = process.exitCode ?? 0
    const commandName = resolveCommandName(actionCommand)

    void sendTelemetryEvent({
      command: commandName,
      duration,
      success: exitCode === 0,
      platform: process.platform,
      user: resolveTelemetryUser(),
    })
  } catch {
    // Never let telemetry break the CLI.
  }

  try {
    const context = resolveHintContext(actionCommand)
    await autoUpdateAfterCommand({
      commandName: context.command,
      currentVersion: buildVersion,
      format: context.format,
      isDevMode: isDevBuild,
    })
  } catch {
    // Never let auto-update break the CLI.
  }
})

// Core commands
program
  .command('init')
  .description('Initialize a new app integration (quick mode)')
  .argument(
    '[name]',
    'Name of the integration (required in non-interactive mode)'
  )
  .option('--json', 'Output result as JSON (machine-readable)')
  .action(async (name, options, command) => {
    const opts =
      typeof command.optsWithGlobals === 'function'
        ? command.optsWithGlobals()
        : {
            ...command.parent?.opts(),
            ...command.opts(),
          }
    const ctx = await createContext({
      format: options.json ? 'json' : opts.format,
      verbose: opts.verbose,
      quiet: opts.quiet,
    })
    await init(ctx, name, options)
  })

program
  .command('wizard')
  .description('Interactive wizard for setting up a new property')
  .option('--json', 'Output result as JSON (machine-readable)')
  .action(async (options, command) => {
    const opts =
      typeof command.optsWithGlobals === 'function'
        ? command.optsWithGlobals()
        : {
            ...command.parent?.opts(),
            ...command.opts(),
          }
    const ctx = await createContext({
      format: options.json ? 'json' : opts.format,
      verbose: opts.verbose,
      quiet: opts.quiet,
    })
    await wizard(ctx, options)
  })

program
  .command('health')
  .description('Test integration endpoint health')
  .argument(
    '[slug|url]',
    'App slug (from database) or URL (e.g., https://totaltypescript.com)'
  )
  .option(
    '-s, --secret <secret>',
    'Webhook secret (required for direct URL mode)'
  )
  .option('-l, --list', 'List all registered apps')
  .option('--ids-only', 'Output only IDs (one per line)')
  .option('--json', 'Output result as JSON (machine-readable)')
  .action(async (slugOrUrl, options, command) => {
    const opts =
      typeof command.optsWithGlobals === 'function'
        ? command.optsWithGlobals()
        : {
            ...command.parent?.opts(),
            ...command.opts(),
          }
    const ctx = await createContext({
      format: options.json ? 'json' : opts.format,
      verbose: opts.verbose,
      quiet: opts.quiet,
    })
    await health(ctx, slugOrUrl, options)
  })

// Eval commands
program
  .command('eval')
  .description('Run evals against a dataset')
  .argument('<type>', 'Eval type (e.g., routing)')
  .argument('<dataset>', 'Path to dataset JSON file')
  .option('--json', 'Output result as JSON (machine-readable)')
  .option(
    '--min-precision <number>',
    'Minimum precision threshold (default: 0.92)',
    parseFloat
  )
  .option(
    '--min-recall <number>',
    'Minimum recall threshold (default: 0.95)',
    parseFloat
  )
  .option(
    '--max-fp-rate <number>',
    'Maximum false positive rate (default: 0.03)',
    parseFloat
  )
  .option(
    '--max-fn-rate <number>',
    'Maximum false negative rate (default: 0.02)',
    parseFloat
  )
  .action(async (type, dataset, options, command) => {
    const ctx = await createContext({
      format:
        options.json === true
          ? 'json'
          : typeof command.optsWithGlobals === 'function'
            ? command.optsWithGlobals().format
            : command.parent?.opts().format,
      verbose:
        typeof command.optsWithGlobals === 'function'
          ? command.optsWithGlobals().verbose
          : command.parent?.opts().verbose,
      quiet:
        typeof command.optsWithGlobals === 'function'
          ? command.optsWithGlobals().quiet
          : command.parent?.opts().quiet,
    })
    const gates = {
      ...(options.minPrecision !== undefined && {
        minPrecision: options.minPrecision,
      }),
      ...(options.minRecall !== undefined && { minRecall: options.minRecall }),
      ...(options.maxFpRate !== undefined && { maxFpRate: options.maxFpRate }),
      ...(options.maxFnRate !== undefined && { maxFnRate: options.maxFnRate }),
    }
    runEval(ctx, type, dataset, {
      json: options.json,
      gates: Object.keys(gates).length > 0 ? gates : undefined,
    })
  })

// Core command registrations
registerDbStatusCommand(program)

// Front commands
registerFrontCommands(program, usageState)

// Inngest commands
registerInngestCommands(program, usageState)

// Axiom commands
registerAxiomCommands(program)

// Eval commands
registerEvalLocalCommands(program)
registerEvalPipelineCommands(program)
registerEvalPromptCommands(program)
registerPipelineCommands(program)

// Data commands
registerDatasetCommands(program)
registerResponseCommands(program)
registerToolsCommands(program)
registerMemoryCommands(program)

// Linear commands
registerLinearCommands(program)

// FAQ commands
registerFaqCommands(program)

// Infra commands
registerDeployCommands(program)
registerKbCommands(program)
registerAuthCommands(program, usageState)
registerConfigCommands(program)

// Plugin commands
registerPluginSyncCommand(program)

program
  .command('mcp')
  .description(
    'Start MCP server for AI coding agent integration.\n' +
      '  Exposes 9 Front tools over JSON-RPC stdio for Claude Code, Cursor, etc.\n' +
      '  Tools: inbox, conversation, message, assign, reply, tag, archive, search, report\n' +
      '  Usage: skill mcp  (then connect your AI editor to stdin/stdout)'
  )
  .action(async () => {
    const server = createMcpServer()
    await server.start()
  })

// Auto-link skill-cli to ~/.claude/skills/ (silent, conflict-safe)
void autoLinkSkill()

// Parse and cleanup DB connections when done
program.parseAsync().finally(async () => {
  // Lazy import — avoid triggering env validation for non-DB commands (--help, --version, front)
  const { closeDb } = await import('@skillrecordings/database')
  await closeDb()
})
