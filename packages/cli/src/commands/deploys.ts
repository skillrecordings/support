import { execSync } from 'child_process'
import { Command } from 'commander'
import { type CommandContext, createContext } from '../core/context'
import { CLIError, formatError } from '../core/errors'

const VERCEL_SCOPE = 'skillrecordings'

// Map of app names to their Vercel project names
const APPS: Record<string, { vercel: string; description: string }> = {
  front: {
    vercel: 'skill-support-agent-front',
    description: 'Front webhook handler (main support pipeline)',
  },
  slack: {
    vercel: 'skill-support-agent-slack',
    description: 'Slack interactions (approvals, notifications)',
  },
}

function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1B\].*?\x07/g, '')
}

function runVercel(args: string): string {
  try {
    // Capture both stdout and stderr (Vercel CLI writes table to stderr)
    const raw = execSync(`vercel ${args} --scope ${VERCEL_SCOPE} --yes 2>&1`, {
      encoding: 'utf-8',
      timeout: 30000,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
    }).trim()
    return stripAnsi(raw)
  } catch (err: any) {
    const out = err.stdout?.trim() || err.stderr?.trim() || err.message
    return stripAnsi(out)
  }
}

function listApps(ctx: CommandContext) {
  ctx.output.data('\n📦 Support Platform Apps\n')
  for (const [name, app] of Object.entries(APPS)) {
    ctx.output.data(
      `  ${name.padEnd(10)} ${app.vercel.padEnd(35)} ${app.description}`
    )
  }
  ctx.output.data('')
}

function resolveApp(
  ctx: CommandContext,
  nameOrAll: string | undefined
): [string, { vercel: string; description: string }][] {
  if (!nameOrAll || nameOrAll === 'all') {
    return Object.entries(APPS)
  }
  const app = APPS[nameOrAll]
  if (!app) {
    throw new CLIError({
      userMessage: `Unknown app: ${nameOrAll}.`,
      suggestion: `Available: ${Object.keys(APPS).join(', ')}, all.`,
    })
  }
  return [[nameOrAll, app]]
}

export async function deploysStatus(
  ctx: CommandContext,
  appName: string | undefined,
  options: { limit?: string; json?: boolean }
) {
  const outputJson = options.json === true || ctx.format === 'json'
  try {
    const apps = resolveApp(ctx, appName)
    const limit = parseInt(options.limit || '5')

    if (outputJson) {
      const results = apps.map(([name, app]) => ({
        name,
        vercel: app.vercel,
        description: app.description,
        status: runVercel(`ls ${app.vercel}`)
          .split('\n')
          .filter((l) => l.includes('https://'))
          .slice(0, limit),
      }))
      ctx.output.data(results)
      return
    }

    for (const [name, app] of apps) {
      ctx.output.data(`\n🚀 ${name} (${app.vercel})`)
      ctx.output.data(`   ${app.description}\n`)

      const output = runVercel(`ls ${app.vercel}`)
      const lines = output.split('\n')
      // Deploy lines contain https:// URLs
      const deployLines = lines.filter((l) => l.includes('https://'))

      if (deployLines.length === 0) {
        ctx.output.data('   No recent deployments found')
      } else {
        // Filter production-only for cleaner output, show all if few deploys
        const prodLines = deployLines.filter((l) => l.includes('Production'))
        const showLines = (
          prodLines.length >= limit ? prodLines : deployLines
        ).slice(0, limit)

        for (const line of showLines) {
          const trimmed = line.trim()
          // Extract known tokens from the line
          const hasReady = trimmed.includes('Ready')
          const hasError = trimmed.includes('Error')
          const hasCanceled = trimmed.includes('Canceled')
          const isProd = trimmed.includes('Production')
          const isPreview = trimmed.includes('Preview')
          const prefix = hasError
            ? '❌'
            : hasCanceled
              ? '⚪'
              : isProd
                ? '🟢'
                : '🔵'

          // Pull age (first token) and environment
          const age = trimmed.split(/\s+/)[0] || ''
          const status = hasError
            ? 'Error'
            : hasCanceled
              ? 'Canceled'
              : hasReady
                ? 'Ready'
                : 'Unknown'
          const env = isProd ? 'Production' : isPreview ? 'Preview' : ''

          // Pull duration (pattern like "30s", "17s")
          const durMatch = trimmed.match(/(\d+s)/)
          const duration = durMatch ? durMatch[1] : ''

          ctx.output.data(
            `   ${prefix} ${age.padEnd(6)} ${status.padEnd(10)} ${env.padEnd(12)} ${duration}`
          )
        }
      }
    }
    ctx.output.data('')
  } catch (error) {
    const cliError =
      error instanceof CLIError
        ? error
        : new CLIError({
            userMessage: 'Failed to fetch deployments.',
            suggestion: 'Verify Vercel CLI access and try again.',
            cause: error,
          })
    ctx.output.error(formatError(cliError))
    process.exitCode = cliError.exitCode
  }
}

export async function deploysLogs(
  ctx: CommandContext,
  appName: string,
  options: { lines?: string; json?: boolean }
) {
  const outputJson = options.json === true || ctx.format === 'json'
  try {
    const apps = resolveApp(ctx, appName)
    if (apps.length > 1) {
      throw new CLIError({
        userMessage: 'Specify a single app for logs (front or slack).',
        suggestion: 'Provide one app name.',
      })
    }

    const [name, app] = apps[0]!
    if (!outputJson) {
      ctx.output.data(`\n📋 Recent logs for ${name} (${app.vercel})\n`)
    }

    // Get latest production deployment URL
    const lsOutput = runVercel(`ls ${app.vercel} --limit 5`)
    const prodLine = lsOutput
      .split('\n')
      .find((l) => l.includes('Production') && l.includes('Ready'))
    const urlMatch = prodLine?.match(/https:\/\/\S+/)

    if (!urlMatch) {
      throw new CLIError({
        userMessage: 'Could not find latest production deployment.',
        suggestion: 'Verify Vercel deployment status.',
      })
    }

    const url = urlMatch[0]

    if (outputJson) {
      const logsOutput = execSync(
        `vercel logs ${url} --scope ${VERCEL_SCOPE} --output short 2>&1 | tail -${options.lines || '30'}`,
        { encoding: 'utf-8', timeout: 30000 }
      )
      ctx.output.data({ app: name, deployment: url, logs: logsOutput.trim() })
      return
    }

    ctx.output.data(`   Deployment: ${url}\n`)

    try {
      const logsOutput = execSync(
        `vercel logs ${url} --scope ${VERCEL_SCOPE} --output short 2>&1 | tail -${options.lines || '30'}`,
        { encoding: 'utf-8', timeout: 30000 }
      )
      ctx.output.data(logsOutput)
    } catch (err: any) {
      ctx.output.data(err.stdout || err.message)
    }
  } catch (error) {
    const cliError =
      error instanceof CLIError
        ? error
        : new CLIError({
            userMessage: 'Failed to fetch logs.',
            suggestion: 'Verify Vercel CLI access and try again.',
            cause: error,
          })
    ctx.output.error(formatError(cliError))
    process.exitCode = cliError.exitCode
  }
}

export async function deploysInspect(
  ctx: CommandContext,
  appName: string,
  options: { json?: boolean }
) {
  const outputJson = options.json === true || ctx.format === 'json'
  try {
    const apps = resolveApp(ctx, appName)
    if (apps.length > 1) {
      throw new CLIError({
        userMessage: 'Specify a single app for inspect (front or slack).',
        suggestion: 'Provide one app name.',
      })
    }

    const [name, app] = apps[0]!

    // Get latest production deployment URL
    const lsOutput = runVercel(`ls ${app.vercel} --limit 3`)
    const prodLine = lsOutput
      .split('\n')
      .find((l) => l.includes('Production') && l.includes('Ready'))
    const urlMatch = prodLine?.match(/https:\/\/\S+/)

    if (!urlMatch) {
      throw new CLIError({
        userMessage: 'Could not find latest production deployment.',
        suggestion: 'Verify Vercel deployment status.',
      })
    }

    const output = runVercel(`inspect ${urlMatch[0]}`)
    if (outputJson) {
      ctx.output.data({ app: name, output })
      return
    }

    ctx.output.data(`\n🔍 Inspecting ${name} latest production deploy\n`)
    ctx.output.data(output)
  } catch (error) {
    const cliError =
      error instanceof CLIError
        ? error
        : new CLIError({
            userMessage: 'Failed to inspect deployment.',
            suggestion: 'Verify Vercel CLI access and try again.',
            cause: error,
          })
    ctx.output.error(formatError(cliError))
    process.exitCode = cliError.exitCode
  }
}

export function registerDeployCommands(program: Command) {
  const deploys = program
    .command('deploys')
    .description('Check Vercel deployment status for support platform apps')

  deploys
    .command('status')
    .description('Show recent deployments for one or all apps')
    .argument('[app]', 'App name (front, slack, all)', 'all')
    .option('-n, --limit <number>', 'Number of deploys to show', '5')
    .option('--json', 'JSON output')
    .action(async (app, options, command) => {
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
      await deploysStatus(ctx, app, options)
    })

  deploys
    .command('logs')
    .description('Show recent logs for an app')
    .argument('<app>', 'App name (front, slack)')
    .option('-n, --lines <number>', 'Number of log lines', '30')
    .option('--json', 'JSON output')
    .action(async (app, options, command) => {
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
      await deploysLogs(ctx, app, options)
    })

  deploys
    .command('inspect')
    .description('Inspect latest production deployment')
    .argument('<app>', 'App name (front, slack)')
    .option('--json', 'JSON output')
    .action(async (app, options, command) => {
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
      await deploysInspect(ctx, app, options)
    })

  // Default: `deploys` with no subcommand = status all
  deploys.action(async (_opts, command) => {
    const ctx = await createContext({
      format:
        typeof command.optsWithGlobals === 'function'
          ? command.optsWithGlobals().format
          : command.opts().format,
      verbose:
        typeof command.optsWithGlobals === 'function'
          ? command.optsWithGlobals().verbose
          : command.opts().verbose,
      quiet:
        typeof command.optsWithGlobals === 'function'
          ? command.optsWithGlobals().quiet
          : command.opts().quiet,
    })
    await deploysStatus(ctx, 'all', { limit: '3' })
  })
}
