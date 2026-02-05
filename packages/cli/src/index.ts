#!/usr/bin/env bun

// Load .env.local before any module that validates env vars (e.g., @skillrecordings/database)
// Bun auto-loads .env in the cwd, but CLI may run from anywhere — explicitly load from package root.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

let envLoaded = false
const cliRoot = resolve(import.meta.dirname, '../..')
for (const envFile of ['.env.local', '.env']) {
  try {
    const content = readFileSync(resolve(cliRoot, envFile), 'utf8')
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eqIdx = trimmed.indexOf('=')
      if (eqIdx === -1) continue
      const key = trimmed.slice(0, eqIdx).trim()
      const raw = trimmed.slice(eqIdx + 1).trim()
      // Strip surrounding quotes
      const value = raw.replace(/^["'](.*)["']$/, '$1')
      if (!process.env[key]) {
        process.env[key] = value
      }
    }
    envLoaded = true
  } catch {
    // File doesn't exist — skip
  }
}

// Skip env validation when no .env file found (e.g., global npm install, --help, --version)
// Commands that need DATABASE_URL will fail at runtime with a clear error instead.
if (!envLoaded && !process.env.DATABASE_URL) {
  process.env.SKIP_ENV_VALIDATION = '1'
}

import { Command } from 'commander'
import { registerAuthCommands } from './commands/auth/index'
import { registerAxiomCommands } from './commands/axiom/index'
import { registerDatasetCommands } from './commands/build-dataset'
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
import { registerMemoryCommands } from './commands/memory/index'
import { registerPipelineCommands } from './commands/pipeline'
import { registerPluginSyncCommand } from './commands/plugin-sync'
import { registerResponseCommands } from './commands/responses'
import { registerToolsCommands } from './commands/tools'
import { wizard } from './commands/wizard'
import { createContext } from './core/context'
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

declare const BUILD_VERSION: string
declare const BUILD_COMMIT: string
declare const BUILD_TARGET: string

const versionLabel = `skill v${buildVersion} (${buildCommit}) ${buildTarget}`

const program = new Command()

program
  .name('skill')
  .description('CLI tool for managing app integrations')
  .version(versionLabel)
  .option('-f, --format <format>', 'Output format (json|text|table)')
  .option('-v, --verbose', 'Enable verbose output')
  .option('-q, --quiet', 'Suppress non-error output')
  .option('--rate-limit <n>', 'Override Front API rate limit per minute', (v) =>
    Number.parseInt(v, 10)
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

// Core commands
program
  .command('init')
  .description('Initialize a new app integration (quick mode)')
  .argument(
    '[name]',
    'Name of the integration (required in non-interactive mode)'
  )
  .option('--json', 'Output result as JSON (machine-readable)')
  .action(init)

program
  .command('wizard')
  .description('Interactive wizard for setting up a new property')
  .option('--json', 'Output result as JSON (machine-readable)')
  .action(wizard)

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
  .action(health)

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
registerFrontCommands(program)

// Inngest commands
registerInngestCommands(program)

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

// FAQ commands
registerFaqCommands(program)

// Infra commands
registerDeployCommands(program)
registerKbCommands(program)
registerAuthCommands(program)

// Plugin commands
registerPluginSyncCommand(program)

program
  .command('mcp')
  .description('Start MCP server for AI coding agent integration')
  .action(async () => {
    const server = createMcpServer()
    await server.start()
  })

// Parse and cleanup DB connections when done
program.parseAsync().finally(async () => {
  // Lazy import — avoid triggering env validation for non-DB commands (--help, --version, front)
  const { closeDb } = await import('@skillrecordings/database')
  await closeDb()
})
